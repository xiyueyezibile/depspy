import { writeFileSync } from "fs";
import path from "path";
import { SourceToImportId } from "./utils";
import { Bundle, Config, idInExternals, postServerGraph } from "./staticModule";
import type { PluginOption, UserConfig } from "vite";
import getAllExportEffected from "./getAllExportEffected";
import { DEP_SPY_START } from "../constant";

export function vitePluginInsight(options: Config): PluginOption {
  console.log(process.env[DEP_SPY_START]);
  if (!process.env[DEP_SPY_START]) {
    return false;
  }
  /** 全局保存 */
  let globalBundle: Bundle;
  // 用户配置
  let userConfig: UserConfig = {} as UserConfig;
  // 源码路径和绝对路径的互相映射
  const sourceToImportIdMap = new SourceToImportId();
  // replace
  options.entry =
    path.sep === "\\" ? options.entry.replace(/\\/g, "/") : options.entry;
  options.root =
    path.sep === "\\" ? options.root.replace(/\\/g, "/") : options.root;
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
      // 获取所有模块的导出改动信息
      const allExportEffected = await getAllExportEffected.call(
        this,
        options.entry,
        new Set([options.entry]),
        sourceToImportIdMap,
        userConfig,
      );
      globalBundle.allExportEffected = allExportEffected;
      // 根据bundle获取实际被打包的模块
      globalBundle.resolveOriginModuleByBundle((originModules) => {
        const distLists = Object.values(bundle);
        distLists.forEach((dist) => {
          Object.entries(dist["modules"] || {}).forEach(([id, data]) => {
            if (!idInExternals(id)) {
              originModules.set(id, data);
            }
          });
        });
      });
      const map = globalBundle.findLoadModuleWithOriginModule();

      globalBundle.newModuleByMap(map);

      // 拿到moduleGraph
      const moduleGraph = globalBundle.moduleGraph;
      moduleGraph.rootId = options.root;
      moduleGraph.entryId = options.entry;
      // 获取所所有导入导出关系
      Object.keys(map.modules).forEach((id) => {
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
      /** 根据导入导出关系构建模块依赖图 */
      moduleGraph.buildGraph();
      moduleGraph.analyseCircleModule(options.entry);
      const jsonName = "moduleTree.json";
      const jsonPath = path.join(options.root, jsonName);
      const data = moduleGraph.genarateTiledTreeByRootId(options.entry);
      const len = 80;

      try {
        await Promise.all(
          new Array(Math.ceil(data.length / len)).fill(0).map((_, i) => {
            return postServerGraph(data.slice(i * len, (i + 1) * len));
          }),
        );
        // 发送end消息
        // await postServerGraph("", "0");
      } catch (error) {
        console.log(error);
      }

      writeFileSync(jsonPath, moduleGraph.stringifyTreeByRootId(options.entry));
    },
  };
}
