import path from "path";
import {
  cacheReturn,
  getFileContentAtCommit,
  getHashFromString,
  isCommonJsById,
  isGitFileModified,
  normalizeIdToFilePath,
  readFileSyncSafe,
  SourceToImportId,
  isPathNeedFilter,
} from "./utils";
import { PluginContext } from "rollup";
import { getTreeShakingDetail as _getTreeShakingDetail } from "./getTreeShakingDetail";
import { VitePluginDepSpyConfig } from "./vitePluginDepSpy";

// 只处理包含JS逻辑的文件类型
const targetExt = new Set<string>([
  ".ts",
  ".js",
  ".jsx",
  ".tsx",
  ".vue",
  ".html",
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

// 获取指定导出真正依赖的源码和真正依赖的引入（复用vite的treeshaking规范）(缓存化)
const getTreeShakingDetail = cacheReturn(_getTreeShakingDetail, (options) => {
  // 以参数作为唯一key进行缓存
  return getHashFromString(
    Object.values(options).reduce((pre, cur) => pre + cur, ""),
  );
});
// getAllExportEffect的包装层，避免外层因为本身的递归参数传入不必要的参数
export default async function getAllExportEffect(
  // 必须在vite的hook上下文中调用
  this: PluginContext,
  // 入口绝对地址
  options: VitePluginDepSpyConfig,
  // 源码引入到绝对路径的映射
  sourceToImportIdMap: SourceToImportId,
) {
  const { entry, ignores = [] } = options;
  return await _getAllExportEffect.call(
    this,
    entry,
    ignores,
    new Set([options.entry]),
    sourceToImportIdMap,
  );
}

// 获取代码中有哪些导出收到了改动的影响（直接或间接）
async function _getAllExportEffect(
  // 必须在vite的hook上下文中调用
  this: PluginContext,
  // 入口绝对地址
  entry: string,
  // 忽略的文件
  ignores: VitePluginDepSpyConfig["ignores"],
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
  // 是否是commonjs规范的文件
  const isCommonJs = isCommonJsById(entry);

  /* 返回空节点，只做展示
    1. 用户配置的忽略文件
    2. 不是JS类型的源码，直接返回
    3. 是commonjs规范的文件
    4. 如果是node_modules下的文件 
  */
  if (
    isPathNeedFilter(entry, ignores) ||
    !targetExt.has(ext) ||
    isCommonJs ||
    entry.includes("node_modules")
  ) {
    // 构造空节点
    const exportEffect: ExportEffectedNode = {
      exportEffectedNames: new Set(),
      importEffectedNames: new Map(),
    };
    importIdToExportEffected.set(entry, exportEffect);
    paths.delete(entry);
    return importIdToExportEffected;
  }
  // 利用vite插件上下文的方法获取当前文件的信息
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
    const promise = _getAllExportEffect.call(
      this,
      importedId,
      ignores,
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
        entry,
        code: isCommonJs ? currentInfo.code : curCode,
        exportName,
      });
      const preTreeShakingCodePromise = getTreeShakingDetail({
        entry,
        code: preCode,
        exportName,
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
