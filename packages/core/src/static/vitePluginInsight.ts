import path from "path";
import { SourceToImportId } from "./utils";
import { Bundle, idInExternals, postServerGraph } from "./staticModule";
import { normalizePath, type PluginOption } from "vite";
import getAllExportEffected, {
  ExportEffectedNode,
} from "./getAllExportEffected";
import { DEP_SPY_START, DEP_SPY_SUB_START } from "../constant";
import { writeFileSync } from "fs";

export interface PluginConfig {
  entry?: string;
  buildCommand?: string;
}
export function vitePluginInsight(options: PluginConfig = {}): PluginOption {
  //只能通过ds命令运行;
  if (!process.env[DEP_SPY_START]) {
    return false;
  }
  // 避免子模块运行导致多次运行
  if (process.env[DEP_SPY_SUB_START]) {
    return false;
  }

  /** 收集vite打包后的相关信息 */
  let globalBundle: Bundle;
  // 源码路径和绝对路径的互相映射
  const sourceToImportIdMap = new SourceToImportId();

  return {
    name: "vite-plugin-insight",
    enforce: "pre",
    configResolved(config) {
      //  设置入口绝对地址，默认是index.html
      options.entry = options?.entry
        ? normalizePath(options.entry)
        : normalizePath(path.resolve(config.root, "index.html"));
      // 初始化
      globalBundle = new Bundle(options);
      // 注入resolveId，保证第一个执行，不会被其他插件阶段
      /* 虽然vite不建议在这里调整插件，但是没有强行限制
         1. 只是收集引入和真实路径的关系，不会影响其他插件运行
         2. 避免被其他强行加入的插件提前拦截影响，比如：vite-plugin-uni
      **/
      /* @ts-ignore */
      config.plugins?.unshift({
        name: "vite-plugin-gen-source-import-map",
        resolveId(id: string, importer: string) {
          if (process.env[DEP_SPY_SUB_START]) {
            return;
          }
          // 调用下一个 resolveId 钩子获取输出
          return this.resolve(id, importer, {
            ...options,
            skipSelf: true,
          }).then((output: { id: string }) => {
            // 保存源码路径和绝对路径的关联
            if (output?.id) {
              sourceToImportIdMap.addRecord(id, importer, output?.id);
            }
            return output;
          });
        },
      });
    },
    load(id) {
      // 收集项目中所有引入的模块信息
      globalBundle.resolveLoadModule(id);
    },
    async generateBundle(_, bundle) {
      // 避免子模块运行打包导致多次运行
      if (process.env[DEP_SPY_SUB_START]) {
        return;
      }
      // 绝对路径=>受到影响的导出 之间的映射
      const allExportEffected: Map<string, ExportEffectedNode> =
        await getAllExportEffected.call(
          this,
          options.entry,
          new Set([options.entry]),
          sourceToImportIdMap,
        );
      // allExportEffected.forEach((key, value) => {
      //   console.log(key, value, "\n");
      // });
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
              if (
                globalBundle.allExportEffected.has(id) ||
                !idInExternals(id)
              ) {
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
      moduleGraph.entryId = options.entry;
      // 获取所所有导入导出关系 （设置生成依赖树需要的数据）
      Object.keys(actualMap.modules).forEach((id) => {
        const info = this.getModuleInfo(id);
        if (info) {
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
      /** 生成铺平的树 */
      const flatTree = moduleGraph.generateTiledTreeByRootId(options.entry);
      // 默认分块长度
      const chunkLen = 80;
      // 分块发送数据给服务器
      try {
        await Promise.all(
          new Array(Math.ceil(flatTree?.length / chunkLen))
            .fill(0)
            .map((_, i) => {
              return postServerGraph(
                flatTree.slice(i * chunkLen, (i + 1) * chunkLen),
              );
            }),
        );
      } catch (error) {
        console.log("数据发送失败:", error);
      }
      const jsonName = "moduleTree.json";
      const jsonPath = path.join(process.cwd(), jsonName);
      writeFileSync(jsonPath, moduleGraph.stringifyTreeByRootId(options.entry));
      // console.log("moduleTree.json文件已生成", flatTree, options.entry);
    },
  };
}
