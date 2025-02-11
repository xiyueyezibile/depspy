import path from "path";
import { ExportEffectedNode, sendDataByChunk, SourceToImportId } from "./utils";
import { Bundle, idInExternals } from "./staticModule";
import { normalizePath, type PluginOption } from "vite";
import getAllExportEffected from "./getAllExportEffected";
import { DEP_SPY_START, DEP_SPY_SUB_START } from "../constant";
import { writeFileSync } from "fs";
import { GetModuleInfo } from "rollup";

export interface VitePluginDepSpyConfig {
  // 项目的入口，默认为index.html
  entry?: string;
  // 忽略的文件路径，正则用test，字符串用includes
  ignores?: (string | RegExp)[];
}
export function vitePluginDepSpy(
  options: VitePluginDepSpyConfig = {},
): PluginOption {
  //只能通过ds命令运行;
  if (!process.env[DEP_SPY_START]) {
    return false;
  }
  // 避免子模块运行导致多次运行
  if (process.env[DEP_SPY_SUB_START]) {
    return false;
  }
  // 收集项目整体打包信息
  let globalBundle: Bundle;

  // 源码路径和绝对路径的互相映射
  const sourceToImportIdMap = new SourceToImportId();

  return {
    name: "vite-plugin-dep-spy",
    enforce: "pre",
    configResolved(config) {
      if (process.env[DEP_SPY_SUB_START]) {
        return;
      }
      //  设置入口绝对地址，默认是index.html
      options.entry = options?.entry
        ? normalizePath(options.entry)
        : normalizePath(path.join(config.root, "index.html"));
      // 初始化
      globalBundle = new Bundle(options.entry);
      // 注入resolveId，保证第一个执行，不会被其他插件阶段
      /* 虽然vite不建议在这里调整插件，但是没有强行限制
         1. 只是收集引入和真实路径的关系，不会影响其他插件运行
         2. 避免被其他强行加入的插件提前拦截影响，比如：vite-plugin-uni
      **/
      /* @ts-ignore */
      config.plugins?.unshift({
        name: "vite-plugin-dep-spy-main-resolve",
        resolveId(id: string, importer: string) {
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
    async generateBundle(_, bundle) {
      // 避免子模块运行打包导致多次运行
      if (process.env[DEP_SPY_SUB_START]) {
        return;
      }
      // 绝对路径=>受到影响的导出 之间的映射
      const allExportEffected: Map<string, ExportEffectedNode> =
        await getAllExportEffected.call(this, options, sourceToImportIdMap);
      // allExportEffected.forEach((key, value) => {
      //   console.log(key, value, "\n");
      // });
      globalBundle.allExportEffected = allExportEffected;
      // 记录bundle获取实际被打包的模块以及真实导出和被treeshaking的导出
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
      // 生成生成依赖树
      const moduleGraph = globalBundle.generateModuleGraph(
        this.getModuleInfo as unknown as GetModuleInfo,
      );
      /** 根据导入导出关系构建模块依赖图（根据上述设置的信息进行构建） */
      moduleGraph.buildGraph();
      /** 分析并标记循环依赖 */
      moduleGraph.analysisCircleModule(options.entry);
      /** 生成铺平的树 */
      const flatTree = moduleGraph.generateTiledTreeByRootId();
      // const entryIdAndExportToFileNames = Array.from(
      //   moduleGraph.entryIdAndExportToFileNames.entries() || [],
      // ).map(([key, value]) => {
      //   return {
      //     [key]: Array.from(value),
      //   };
      // });
      // 分块发送数据给服务器
      await sendDataByChunk(flatTree, "/collectBundle");
      // await sendDataByChunk(
      //   entryIdAndExportToFileNames,
      //   "/collectEntryIdAndExportToFileNames",
      // );
      const jsonName = "moduleTree.json";
      const jsonPath = path.join(process.cwd(), jsonName);
      writeFileSync(jsonPath, moduleGraph.stringifyTreeByRootId());
    },
  };
}
