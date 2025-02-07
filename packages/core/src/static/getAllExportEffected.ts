import { build } from "vite";
import path from "path";
import {
  findSourceToImportsFormAst,
  getFileContentAtCommit,
  getHashFromString,
  isGitFileModified,
  normalizeIdToFilePath,
  readFileSyncSafe,
  SourceToImportId,
} from "./utils";
import { PluginContext } from "rollup";
import { DEP_SPY_SUB_START } from "../constant";

// 只处理包含JS逻辑的文件类型
const targetExt = new Set<string>([
  ".ts",
  ".js",
  ".jsx",
  ".tsx",
  ".vue",
  ".html",
]);
// 需要处理打包后代码的文件类型
const extToTransformMap = new Map([
  [
    ".vue",
    (code: string) => {
      return code.replace(/"__scopeId", ".*"/, "").replace(/__name: .*,/, "");
    },
  ],
]);
// 绝对路径=>导出受到影响的导出
export interface ExportEffectedNode {
  // 受影响的导出
  exportEffectedNames: Set<string>;
  // 受影响的导入,例如：{ "/user/code/a.ts": ["a","b","default"] }
  importEffectedNames: Map<string, Set<string>>;
  // 是否有代码变更
  isGitChange?: boolean;
  // 是否有导入变更
  isImportChange?: boolean;
  // 是否有副作用变更
  isSideEffectChange?: boolean;
}
const importIdToExportEffected: Map<string, ExportEffectedNode> = new Map();
// 记录已经进入的处理队列的Promise
const importIdToExportEffectedPromise: Map<
  string,
  Promise<Map<string, Set<string>>>
> = new Map();

// 获取代码中有哪些导出收到了改动的影响（直接或间接）
export default async function getAllExportEffect(
  // 必须在vite的hook上下文中调用
  this: PluginContext,
  // 入口绝对地址
  entry: string,
  // 当前节点经过的树路径
  paths: Set<string>,
  // 源码引入到绝对路径的映射
  sourceToImportIdMap: SourceToImportId,
) {
  // 进入节点记录路径
  paths.add(entry);
  // 计算过该文件哪些导出受到了影响，直接返回
  if (importIdToExportEffected.has(entry)) {
    paths.delete(entry);
    return importIdToExportEffected;
  }
  // 当前文件的后缀
  const ext = path.extname(normalizeIdToFilePath(entry));
  // 如果是node_modules下的文件或者不是JS类型的源码，直接返回
  if (!targetExt.has(ext) || entry.includes("node_modules")) {
    const exportEffect: ExportEffectedNode = {
      exportEffectedNames: new Set(),
      importEffectedNames: new Map(),
    };
    importIdToExportEffected.set(entry, exportEffect);
    paths.delete(entry);
    return importIdToExportEffected;
  }
  const currentInfo = this.getModuleInfo(entry);
  // 保证该文件的import的影响已经计算完成
  const importDepPromise: Promise<Map<string, Set<string>>>[] = [];
  // 该文件引入的所有依赖（静态引入 + 动态引入）
  const allImportIds = [
    ...(currentInfo?.importedIds || []),
    ...(currentInfo?.dynamicallyImportedIds || []),
  ];
  allImportIds.forEach((importedId) => {
    // 循环依赖直接退出（ TODO: 是否能以函数粒度继续分析 ）
    if (paths.has(importedId)) {
      return;
    }
    // 该依赖已经开始解析，直接获取原有promise进入等待队列
    if (importIdToExportEffectedPromise.has(importedId)) {
      importDepPromise.push(importIdToExportEffectedPromise.get(importedId));
      return;
    }
    const promise = getAllExportEffect.call(
      this,
      importedId,
      new Set([...paths, importedId]),
      sourceToImportIdMap,
    );
    importIdToExportEffectedPromise.set(importedId, promise);
    importDepPromise.push(promise);
  });
  // 确保改文件的所有依赖都已经解析完成
  await Promise.all(importDepPromise);
  const preCode = getFileContentAtCommit(entry, "HEAD");
  const curCode = readFileSyncSafe(entry);
  const exportChanges: ExportEffectedNode = {
    exportEffectedNames: new Set(),
    importEffectedNames: new Map(),
  };
  const exportEffectPromise: Promise<void>[] = [];
  // 遍历当前文件的导出，判断各个导出是否有变动
  if (currentInfo?.exports.length) {
    currentInfo?.exports?.forEach((exportName: string) => {
      const curTreeShakingCodePromise = getTreeShakingDetail({
        code: curCode || "",
        exportName,
        ext,
      });
      const preTreeShakingCodePromise = getTreeShakingDetail({
        code: preCode || "",
        exportName,
        ext,
      });

      const mergePromise = Promise.all([
        curTreeShakingCodePromise,
        preTreeShakingCodePromise,
      ]).then(([cur, pre]) => {
        // 如果git发生的变化，和上个版本比较，本身的代码是否变动
        if (isGitFileModified(entry)) {
          const curHash = getHashFromString(cur.treeShakingCode);
          const preHash = getHashFromString(pre.treeShakingCode);
          if (curHash !== preHash) {
            exportChanges.isGitChange = true;
            exportChanges.exportEffectedNames.add(exportName);
          }
        }
        // 该导出依赖的静态引入是否变动
        cur.sourceToImports.forEach((imports, source) => {
          // 引入文件的哪些导出受到了影响
          const importId =
            sourceToImportIdMap.getImportIdBySource(source, entry) || "";
          const sourceExportEffect = importIdToExportEffected.get(importId);
          if (sourceExportEffect) {
            // 依次确认哪些引入有改动
            imports.forEach((_import) => {
              // 1. 该引入有改动
              // 2. 全量引入且该引入文件的受影响的导出不为空
              // 3. 该引入文件有副作用变动
              if (
                sourceExportEffect?.exportEffectedNames.has(_import) ||
                (_import === "*" &&
                  sourceExportEffect?.exportEffectedNames.size) ||
                sourceExportEffect.isSideEffectChange
              ) {
                // 构建exportChanges节点
                exportChanges.isImportChange = true;
                const importEffectedName =
                  exportChanges.importEffectedNames.get(importId);
                if (importEffectedName) {
                  importEffectedName.add(_import);
                } else {
                  // 首次进入进入逻辑
                  exportChanges.importEffectedNames.set(
                    importId,
                    new Set([_import]),
                  );
                }
                exportChanges.exportEffectedNames.add(exportName);
              }
            });
          }
        });
        // 该导出依赖的动态引入是否变动
        cur.dynamicallySource.forEach((source) => {
          // 动态引入文件的绝对路径
          const importId =
            sourceToImportIdMap.getImportIdBySource(source, entry) || "";
          // 动态引入的文件是否有导出受到影响
          const hasExportEffected = Boolean(
            importIdToExportEffected.get(importId)?.exportEffectedNames.size,
          );
          // 如果动态引入有变化，则该导出受到影响
          if (hasExportEffected) {
            // 标记该节点有导入变动
            exportChanges.isImportChange = true;
            // 动态导入默认为全量引入，所以影响添加为*
            exportChanges.importEffectedNames.set(importId, new Set(["*"]));
            // 标记该导出受到影响
            exportChanges.exportEffectedNames.add(exportName);
          }
        });
      });
      exportEffectPromise.push(mergePromise);
    });
  } else {
    // 没有导出，但是被引入打包项目的特例，比如：作为入口的index.html
    // 对比文件是否有变动即可
    if (isGitFileModified(entry)) {
      exportChanges.isGitChange = true;
      // 没有导出的文件，可以直接标记为副作用变动
      exportChanges.isSideEffectChange = true;
    }

    // 检查该文件依赖的静态引入是否变动
    currentInfo?.importedIds.forEach((importId) => {
      const exportEffected = importIdToExportEffected.get(importId);
      // 1. 该引入有改动的导出有变化 2. 该引入副作用有变化
      if (
        exportEffected?.exportEffectedNames.size ||
        exportEffected?.isSideEffectChange
      ) {
        exportChanges.isImportChange = true;
        // 没有导出的文件，可以直接标记为副作用变动
        exportChanges.isSideEffectChange = true;
        // 因为是html的script引入，所以默认为全量引入
        // 增量加入
        exportChanges.importEffectedNames.set(
          importId,
          exportEffected.exportEffectedNames,
        );
      }
    });
  }

  // 版本改文件是否受到影响 1. 本身代码改动 2. 有导入受到影响
  await Promise.all(exportEffectPromise);
  importIdToExportEffected.set(entry, exportChanges);
  paths.delete(entry);
  return importIdToExportEffected;
}

// 构造导入语句
function constructImportStatement(importedId: string, importName: string) {
  // 处理默认导入
  if (importName === "default") {
    return `import defaultName from '${importedId}';console.log(defaultName);`;
  }
  // 处理命名空间导入
  if (importName === "*") {
    return `import * as all from '${importedId}';console.log(all);`;
  }
  // 处理具名导入
  return `import { ${importName} } from '${importedId}';console.log(${importName});`;
}
// 获取指定导出真正依赖的源码和真正依赖的引入（复用vite的treeshaking规范）
interface GetTreeShakingDetailOptions {
  code: string;
  exportName: string;
  ext: string;
}
// 通过vite的treeshaking规范获取指定导出真正依赖的源码和真正依赖的引入
async function getTreeShakingDetail(options: GetTreeShakingDetailOptions) {
  const { code, exportName, ext } = options;
  const virtualSourceModuleId = `virtual:source${ext}`;
  const virtualImporterModuleId = `virtual:importer.js`;
  const virtualModules = {
    [virtualSourceModuleId]: code,
    [virtualImporterModuleId]: constructImportStatement(
      virtualSourceModuleId,
      exportName,
    ),
  };
  // treeshaking后的代码
  let treeShakingCode = "";
  // 源码的引入路径和对应引入的变量，例如：{ "./a": ["a","b","default"] }
  let sourceToImports: Map<string, Set<string>> = new Map();
  // 动态import的集合
  let dynamicallySource = new Set<string>();
  try {
    await build({
      build: {
        minify: false,
        write: false,
        modulePreload: {
          polyfill: false,
        },
      },
      optimizeDeps: {
        force: true,
      },
      plugins: [
        {
          name: "vite-plugin-find-export-dependency",
          enforce: "pre",
          buildStart() {
            process.env[DEP_SPY_SUB_START] = "true";
          },
          configResolved(config) {
            // 注入resolveId，保证第一个执行，不会被其他插件阶段
            /* 虽然vite不建议在这里调整插件，但是没有强行限制
               1. 避免被其他强行加入的插件提前拦截影响，比如：vite-plugin-uni
            **/
            /* @ts-ignore */
            config.plugins?.unshift({
              name: "vite-plugin-find-export-dependency-sub",
              resolveId(
                id: string,
                importer: string,
                options: { isEntry: boolean },
              ) {
                // 入口引入直接替换为虚拟模块
                if (options.isEntry) {
                  return virtualImporterModuleId;
                }
                // 虚拟模块之间的引入（去除可能存在的查询参数)
                const realId = normalizeIdToFilePath(id);
                if (realId in virtualModules) {
                  return id;
                }
                return {
                  id,
                  external: true,
                  moduleSideEffects: true,
                };
              },
            });
          },
          config(config) {
            // 兼容有分包的逻辑
            if (Array.isArray(config?.build?.rollupOptions?.output)) {
              config.build.rollupOptions.output.map((item) => {
                delete item.manualChunks;
              });
            } else {
              delete config?.build?.rollupOptions?.output?.manualChunks;
            }
          },
          // 虚拟模块加载逻辑
          load(id) {
            if (id in virtualModules) {
              return virtualModules[id];
            }
            return null;
          },
          generateBundle(_, chunk) {
            Object.values(chunk).forEach((module) => {
              // 处理源码，不处理静态资源
              if (module.type === "chunk") {
                // 文件类型需要特殊处理，比如vue文件的scopeId每次都会变化，无法进行对比，需要去除
                if (extToTransformMap.has(ext)) {
                  treeShakingCode = extToTransformMap.get(ext)!(module?.code);
                } else {
                  treeShakingCode = module?.code;
                }
                // 获取源码的引入路径和对应引入的变量，例如：{ "./a": ["a","b","default"] }
                sourceToImports = findSourceToImportsFormAst(
                  this.parse(module?.code || ""),
                );
                // 收集动态导入
                dynamicallySource =
                  new Set(
                    this.getModuleInfo(virtualSourceModuleId)
                      ?.dynamicallyImportedIds,
                  ) || new Set();
              }
            });
          },
        },
      ],
    });
  } catch (e) {
    /* 打包报错有以下原因：直接返回源码
          1. 代码中有语法错误
          2. 代码中有导入不存在的模块
        */
    console.log(e);
    return {
      treeShakingCode: code,
      sourceToImports,
      dynamicallySource,
    };
  }
  return {
    treeShakingCode,
    sourceToImports,
    dynamicallySource,
  };
}
