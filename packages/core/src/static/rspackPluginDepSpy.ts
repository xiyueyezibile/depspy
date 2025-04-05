import path from "path";
import { GetModuleInfo, PluginDepSpyConfig } from "../type";
import type { Compilation, Compiler, Module } from "@rspack/core";
import { sendDataByChunk, SourceToImportId } from "./utils";
import { DEP_SPY_START, DEP_SPY_WEBPACK_BUILD } from "../constant";
import { Bundle } from "./staticModule";
import { writeFileSync } from "fs";

export class rspackPluginDepSpy {
  constructor(
    private options: PluginDepSpyConfig = {},
    private sourceToImportIdMap = new SourceToImportId(),
  ) {}
  apply(compiler: Compiler) {
    console.log("rspackPluginDepSpy");

    //只能通过ds命令运行;
    if (!process.env[DEP_SPY_START]) {
      return false;
    }
    // 标记webpack构建
    process.env[DEP_SPY_WEBPACK_BUILD] = "true";

    compiler.hooks.beforeRun.tapPromise(
      "EntryPathPlugin",
      async (compilation) => {
        console.log("EntryPathPlugin");
        // 如果用户没有提供entry，由webpack解析到的第一个entry作为入口
        if (!this.options.entry) {
          let entry = "";
          Object.values(compiler.options.entry).some((value) => {
            if (typeof value === "string") {
              entry = value;
              return true;
            } else if (Array.isArray(value)) {
              entry = value[0];
              return true;
            } else if (typeof value === "object") {
              Object.values(value).some((v) => {
                if (typeof v === "string") {
                  entry = v;
                  return true;
                } else if (Array.isArray(v)) {
                  entry = v[0];
                  return true;
                }
              });
            }
          });

          const context = compiler.options.context || process.cwd();

          this.options.entry = path.resolve(context, entry);
          console.log(this.options.entry, context);
        }
      },
    );

    compiler.hooks.done.tapPromise(
      "rspackDependencyTreePlugin",
      async (_stats) => {
        const cache = _stats.toJson();
        const dependencyTree = new Map();
        for (const module of cache.modules) {
          const context = compiler.options.context || process.cwd();
          const usedExports =
            typeof module.usedExports === "boolean"
              ? []
              : module.usedExports || []; // 被使用的导出
          const providedExports = module.providedExports || []; // 所有导出]
          const absolutePathByImported = path.resolve(context, module.name);

          for (const reason of module.reasons) {
            const mode = reason.type.split(" ")[0]; // esm | cjs

            if (mode === "esm" || mode === "cjs") {
              const relativePathByImported = reason.userRequest; // 被导入模块的相对名字
              
              const absolutePathByImporter = reason.resolvedModule? path.resolve(
                context,
                reason.resolvedModule,
              ): path.resolve(context, reason.moduleName); // 导入模块的绝对名字
              this.sourceToImportIdMap.addRecord(
                relativePathByImported,
                absolutePathByImporter,
                absolutePathByImported,
              );

              const importedIds = [
                ...new Set([
                  ...(dependencyTree.get(absolutePathByImporter)?.importedIds ||
                    []),
                  absolutePathByImported,
                ]),
              ];

              dependencyTree.set(absolutePathByImporter, {
                ...(dependencyTree.get(absolutePathByImporter) || {}),
                importedIds: importedIds,
                dynamicallyImportedIds: [],
              });
            }

            try {
              dependencyTree.set(absolutePathByImported, {
                ...(dependencyTree.get(absolutePathByImported) || {}),
                removedExports: providedExports.filter(
                  (item: string) => !usedExports.includes(item),
                ), // 被移除的导出
                renderedExports: usedExports,
              });
            } catch (error) {
              console.log(
                "ccc",
                absolutePathByImported,
                providedExports,
                usedExports,
              );
            }
          }
        }
        const getModuleInfo: GetModuleInfo = (importId) => {
          const {
            importedIds,
            dynamicallyImportedIds,
            removedExports,
            renderedExports,
          } = dependencyTree.get(importId) || {};
          return {
            importedIds: [...(importedIds || [])],
            dynamicallyImportedIds: [...(dynamicallyImportedIds || [])],
            removedExports,
            renderedExports,
          };
        };
        // 生成依赖树
        try {
          const globalBundle = new Bundle(
            this.options,
            this.sourceToImportIdMap,
            getModuleInfo,
          );
          const moduleGraph = await globalBundle.generateModuleGraph();
          /** 生成铺平的树 */
          const flatTree = moduleGraph.generateTiledTreeByRootId();
          
          await sendDataByChunk(flatTree, "/collectBundle");
          const jsonPath = path.join(process.cwd(), "moduleTree.json");
          writeFileSync(jsonPath, moduleGraph.stringifyTreeByRootId());
        } catch (error) {
          console.log("bundle error", error);
        }
      },
    );
  }
}
