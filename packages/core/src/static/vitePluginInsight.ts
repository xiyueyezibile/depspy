import { writeFileSync } from "fs";
import path from "path";
import { Bundle, Config,  idInExternals } from "./staticModule";

export function vitePluginInsight(options: Config): any {
  /** 全局保存 */
  let globleBundle: Bundle;
  return {
    name: "vite-plugin-insight",
    configResolved() {
      // 初始化
      globleBundle = new Bundle(options);
    },
    load(id) {
      globleBundle.resolveLoadModule(id);
    },
   
    generateBundle(_, bundle) {
      // 根据bundle获取实际被打包的模块
      globleBundle.resolveOriginModuleByBundle(
        (originModules) => {
          const distLists = Object.values(bundle);
          distLists.forEach((dist) => {
            Object.entries(dist["modules"] || {}).forEach(([id, data]) => {
              if (!idInExternals(id)) {
                originModules.set(id, data);
              }
            });
          });
        },
      );
      const map = globleBundle.findLoadModuleWithOriginModule();
      globleBundle.newModuleByMap(map);

      // 拿到moduleGraph
      const moduleGraph = globleBundle.moduleGraph;
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
      writeFileSync(jsonPath, moduleGraph.stringifyTreeByRootId(options.entry));
      // bundle[jsonName] = {
      //   type: 'asset',
      //   fileName: jsonName,
      //   name: jsonName,
      //   source: moduleGraph.stringifyTreeByRootId(options.entry),
      //   needsCodeReference: false,
      // }
      // unlinkSync(jsonPath);
    },
  };
}
