import { writeFileSync } from "fs";
import path from "path";
import { SourceToImportId } from "./utils";
import { Bundle, Config, idInExternals, postServerGraph } from "./staticModule";
import { type PluginOption, type UserConfig } from "vite";
import getAllExportEffected, {
  ExportEffectedNode,
} from "./getAllExportEffected";
import { DEP_SPY_SUB_START } from "../constant";

export function vitePluginInsight(options: Config): PluginOption {
  // if (!process.env[DEP_SPY_START]) {
  //   return false;
  // }
  if (process.env[DEP_SPY_SUB_START]) {
    return false;
  }
  /** 全局保存 */
  let globalBundle: Bundle;
  // 用户配置
  let userConfig: UserConfig = {} as UserConfig;
  // 源码路径和绝对路径的互相映射
  const sourceToImportIdMap = new SourceToImportId();
  // 规范化路径
  options.entry = path.normalize(options.entry);
  options.root = path.normalize(options.root);

  return {
    name: "vite-plugin-insight",
    enforce: "pre",

    configResolved() {
      // 初始化
      globalBundle = new Bundle(options);
    },
    config(_userConfig) {
      userConfig = _userConfig;
    },
    resolveId(id, importer, options) {
      // 调用下一个 resolveId 钩子获取输出
      return this.resolve(id, importer, { ...options, skipSelf: true }).then(
        (output) => {
          if (output?.id) {
            sourceToImportIdMap.addRecord(id, importer, output?.id);
          }
          return output;
        },
      );
    },
    load(id) {
      globalBundle.resolveLoadModule(id);
    },
    async generateBundle(_, bundle) {
      // 避免子模块运行打包导致多次运行
      if (process.env[DEP_SPY_SUB_START]) {
        return;
      }
      const allExportEffected: Map<string, ExportEffectedNode> =
        await getAllExportEffected.call(
          this,
          options.entry,
          new Set([options.entry]),
          sourceToImportIdMap,
          userConfig,
        );
      allExportEffected.forEach((key, value) => {
        console.log(key, value, "\n");
      });
      globalBundle.allExportEffected = allExportEffected;
      // 根据bundle获取实际被打包的模块
      globalBundle.resolveOriginModuleByBundle((originModules) => {
        // 产物列表（包含静态资源和代码模块）
        const distLists = Object.values(bundle);
        distLists.forEach((dist) => {
          // 只处理代码块
          if (dist.type === "chunk") {
            // 改分块代码由哪些引入模块构成
            Object.entries(dist.modules || {}).forEach(([id, data]) => {
              // 需引入代码直接依赖的三方包，但排出三方包的后续依赖
              if (allExportEffected.has(id) || !idInExternals(id)) {
                originModules.set(id, {
                  removedExports: data.removedExports,
                  renderedExports: data.renderedExports,
                });
              }
            });
          }
        });
      });
      // 寻找在load阶段和打包阶段都存在的模块（去除了treeShaking的模块）
      const actualMap = globalBundle.findLoadModuleWithOriginModule();

      // 挂载生成依赖树的类（只是壳子）
      globalBundle.newModuleByMap(actualMap);
      // 拿到moduleGraph （设置生成依赖树需要的数据）
      const moduleGraph = globalBundle.moduleGraph;
      moduleGraph.rootId = options.root;
      moduleGraph.entryId = options.entry;
      // 获取所所有导入导出关系 （设置生成依赖树需要的数据）
      Object.keys(actualMap.modules).forEach((id) => {
        const info = this.getModuleInfo(id);
        if (info && info.isIncluded) {
          moduleGraph.importers.set(info.id, info.importers);
          moduleGraph.importedIds.set(info.id, info.importedIds);
          moduleGraph.dynamicImporters.set(info.id, info.dynamicImporters);
          moduleGraph.dynamicallyImportedIds.set(
            info.id,
            info.dynamicallyImportedIds,
          );
        }
      });

      /** 根据导入导出关系构建模块依赖图（根据上述设置的信息进行构建） */
      moduleGraph.buildGraph();
      /** 分析并标记循环依赖 */
      moduleGraph.analysisCircleModule(options.entry);
      const jsonName = "moduleTree.json";
      const jsonPath = path.join(options.root, jsonName);
      /** 生成铺平的树 */
      const flatTree = moduleGraph.generateTiledTreeByRootId(options.entry);
      const len = 80;

      // 分块发送数据给服务器
      try {
        await Promise.all(
          new Array(Math.ceil(flatTree.length / len)).fill(0).map((_, i) => {
            return postServerGraph(flatTree.slice(i * len, (i + 1) * len));
          }),
        );
      } catch (error) {
        console.log(error);
      }

      writeFileSync(jsonPath, moduleGraph.stringifyTreeByRootId(options.entry));
      console.log("moduleTree.json文件已生成");
    },
  };
}
