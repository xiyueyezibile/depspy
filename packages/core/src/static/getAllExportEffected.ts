import { build, UserConfig } from "vite";
import path from "path";
import {
  findSourceToImportsFormAst,
  getFileContentAtCommit,
  getHashFromString,
  readFileSyncSafe,
  SourceToImportId,
} from "./utils";
import { PluginContext } from "rollup";

// 只处理包含JS逻辑的文件类型
const targetExt = new Set<string>([".ts", ".js", ".jsx", ".tsx", ".vue"]);
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
  exportEffectedNames: Set<string>;
  // 是否有代码变更
  isGitChange?: boolean;
  // 是否有导入变更
  isImportChange?: boolean;
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
  // 用户的vite的配置
  userConfig: UserConfig,
) {
  // 进入节点记录路径
  paths.add(entry);
  // 计算过该文件哪些导出受到了影响，直接返回
  if (importIdToExportEffected.has(entry)) {
    paths.delete(entry);
    return importIdToExportEffected;
  }
  const ext = path.extname(entry);
  // 如果是node_modules下的文件或者不是JS类型的源码，直接返回
  if (entry.includes("node_modules") || !targetExt.has(ext)) {
    const exportEffect: ExportEffectedNode = { exportEffectedNames: new Set() };
    importIdToExportEffected.set(entry, exportEffect);
    paths.delete(entry);
    return importIdToExportEffected;
  }
  const currentInfo = this.getModuleInfo(entry);
  // 保证该文件的import的影响已经计算完成
  const importDepPromise: Promise<Map<string, Set<string>>>[] = [];
  currentInfo?.importedIds?.forEach((importedId) => {
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
      userConfig,
    );
    importIdToExportEffectedPromise.set(importedId, promise);
    importDepPromise.push(promise);
  });
  // 确保改文件的所有依赖都已经解析完成
  await Promise.all(importDepPromise);

  const preCode = getFileContentAtCommit(entry, "HEAD");
  const curCode = readFileSyncSafe(entry);
  const exportChanges: ExportEffectedNode = { exportEffectedNames: new Set() };
  const exportEffectPromise: Promise<void>[] = [];

  // 遍历当前文件的导出，判断各个导出是否有变动
  currentInfo?.exports?.forEach((exportName: string) => {
    const curTreeShakingCodePromise = getTreeShakingDetail({
      code: curCode || "",
      exportName,
      ext: ext,
      userConfig,
    });
    const preTreeShakingCodePromise = getTreeShakingDetail({
      code: preCode || "",
      exportName,
      ext: ext,
      userConfig,
    });
    const mergePromise = Promise.all([
      curTreeShakingCodePromise,
      preTreeShakingCodePromise,
    ]).then(([cur, pre]) => {
      // 和上个版本比较，本身的代码是否变动
      const curHash = getHashFromString(cur.treeShakingCode);
      const preHash = getHashFromString(pre.treeShakingCode);
      if (curHash !== preHash) {
        exportChanges.isGitChange = true;
        exportChanges.exportEffectedNames.add(exportName);
      }
      // 该导出依赖的引入是否变动,
      cur.sourceToImports.forEach((imports, source) => {
        // 引入文件的哪些导出受到了影响
        const sourceExportEffect = importIdToExportEffected.get(
          sourceToImportIdMap.getImportIdBySource(source, entry) || "",
        )?.exportEffectedNames;
        if (sourceExportEffect) {
          // 依次确认哪些引入有改动
          imports.forEach((_import) => {
            // 1. 该引入有改动
            // 2. 全量引入且该引入文件的受影响的导出不为空
            if (
              sourceExportEffect.has(_import) ||
              (_import === "*" && sourceExportEffect.size)
            ) {
              exportChanges.isImportChange = true;
              exportChanges.exportEffectedNames.add(exportName);
            }
          });
        }
      });
    });
    exportEffectPromise.push(mergePromise);
  });
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
    return `import defaultName from '${importedId}';defaultName();`;
  }
  // 处理命名空间导入
  if (importName === "*") {
    return `import * as all from '${importedId}';all();`;
  }
  // 处理具名导入
  return `import { ${importName} } from '${importedId}';${importName}();`;
}
// 获取指定导出真正依赖的源码和真正依赖的引入（复用vite的treeshaking规范）
interface GetTreeShakingDetailOptions {
  code: string;
  exportName: string;
  ext: string;
  userConfig: UserConfig;
}
// 通过vite的treeshaking规范获取指定导出真正依赖的源码和真正依赖的引入
async function getTreeShakingDetail(options: GetTreeShakingDetailOptions) {
  const { code, exportName, ext } = options;
  const virtualSourceModuleId = `virtual:source${ext ? `${ext}` : ""}`;
  const virtualImporterModuleId = "virtual:importer";
  const virtualModules = {
    [virtualSourceModuleId]: code,
    [virtualImporterModuleId]: constructImportStatement(
      virtualSourceModuleId,
      exportName,
    ),
  };
  let treeShakingCode = "";
  let sourceToImports: Map<string, Set<string>> = new Map();
  try {
    await build({
      build: {
        minify: false,
        write: false,
        modulePreload: {
          polyfill: false,
        },
      },
      plugins: [
        {
          name: "find-export-dependency",
          enforce: "pre",
          buildStart() {
            process.env["ds-test"] = "true";
          },
          resolveId(id, importer) {
            if (importer?.endsWith(".html")) {
              return virtualImporterModuleId;
            }
            if (id in virtualModules) {
              return id;
            }
            if (importer === virtualSourceModuleId) {
              return { id, external: true, moduleSideEffects: false };
            }
            return null;
          },
          config(config) {
            delete config.build.rollupOptions.output;
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
                treeShakingCode = module?.code || "";
                // 有些文件类型需要特殊处理
                if (extToTransformMap.has(ext)) {
                  treeShakingCode = extToTransformMap.get(ext)!(module?.code);
                }
                sourceToImports = findSourceToImportsFormAst(
                  this.parse(module?.code || ""),
                );
              }
            });
          },
        },
      ],
    });
  } catch (e) {
    /* 打包报错有以下原因：可以直接认为有变动
          1. 代码中有语法错误
          2. 代码中有导入不存在的模块
        */
    console.log(e);
    return {
      treeShakingCode,
      sourceToImports,
    };
  }

  return {
    treeShakingCode,
    sourceToImports,
  };
}
