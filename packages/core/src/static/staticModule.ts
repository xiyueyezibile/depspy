import { ExportEffectedNodeSerializable } from "../type";
import { ExportEffectedNode } from "./utils";
import { getGitRootPath } from "./utils";
import { GetModuleInfo, ModuleInfo } from "rollup";

export const externals = ["node_modules"];

export function idInExternals(id: string) {
  return externals.some((external) => {
    return id.includes(external);
  });
}

interface ModuleTree {
  children?: ModuleTree[];
  parentId?: string;
  // 当前
  id: string;
  pathId: string;
  name: string;
  // circleIds: string[][]
  depth: number;
  path: string[];
  idpath: string[];
  rootId?: string;
  // 该文件对比上次git提交是否有改动
  isGitChange: boolean;
  // 该文件的引入是否有改动
  isImportChange: boolean;
  // 该文件的副作用是否有改动（只限于非js类型）
  isSideEffectChange: boolean;
  removedExports: string[];
  renderedExports: string[];
  // 该文件的哪些导出有改动
  exportEffectedNamesToReasons: ExportEffectedNodeSerializable["exportEffectedNamesToReasons"];
  // 该文件的哪些导入有改动, 例如 { './a': ['a','default'] }
  importEffectedNames: ExportEffectedNodeSerializable["importEffectedNames"];
}

class Module {
  id: string;
  /** key的导入者value */
  importers: Module[] = [];
  dynamicImporters: Module[] = [];
  /** key导入value */
  importedIds: Module[] = [];
  dynamicallyImportedIds: Module[] = [];
  removedExports: string[] = [];
  renderedExports: string[] = [];
  circleModules = new Map<string, Module[]>();
  constructor(id: string) {
    this.id = id;
  }
}

// 构建模块依赖以及相关信息
class ModuleGraph {
  graph = new Map<string, Module>();
  /** key的导入者value */
  importers = new Map<string, readonly string[]>();
  dynamicImporters = new Map<string, readonly string[]>();
  /** key导入value */
  importedIds = new Map<string, readonly string[]>();
  dynamicallyImportedIds = new Map<string, readonly string[]>();

  bundle: Bundle;
  entryId: string;
  rootId: string;
  tiledTree: ModuleTree[] = [];
  private _moduleIds = new Map<string, number>();
  /**文件id+导出名 to 导入文件名列表 */
  entryIdAndExportToFileNames = new Map<string, Set<string>>();
  constructor(
    bundle: Bundle,
    entryId: string,
    allModules: Map<string, ModuleInfo | null>,
  ) {
    this.bundle = bundle;
    this.rootId = getGitRootPath();
    this.entryId = entryId;
    allModules.forEach((info, id) => {
      this.graph.set(id, new Module(id));
      this.importers.set(id, info?.importers || []);
      this.importedIds.set(id, info?.importedIds || []);
      this.dynamicImporters.set(id, info?.dynamicImporters || []);
      this.dynamicallyImportedIds.set(
        info?.id,
        info?.dynamicallyImportedIds || [],
      );
    });
  }
  /** 是否有重复模块 */
  static hasDuplicate(modules: Module[]) {
    if (!modules || modules.length === 0) return false;
    const ids = modules.map((module) => module.id);
    return new Set(ids).size !== ids.length;
  }
  /** 返回重复模块 */
  static getDuplicate(modules: Module[]): Module | null {
    if (!modules || modules.length === 0) return null;
    const seen = new Set();
    for (const module of modules) {
      if (seen.has(module.id)) return module;
      seen.add(module.id);
    }
    return null;
  }
  /** 返回包括该 module 之后的数组 */
  static subarrayFromFirstMatch(module: Module, modules: Module[]) {
    const index = modules.map((i) => i.id).indexOf(module.id);
    if (index === -1) return null;
    return modules.slice(index);
  }

  buildGraph() {
    this.graph.forEach((module) => {
      const id = module.id;
      if (this.importedIds.has(id)) {
        const importedIds = this.importedIds.get(id);
        module.importedIds = importedIds
          .map((item) => {
            return this.graph.get(item);
          })
          .filter(Boolean);
      }
      if (this.dynamicallyImportedIds.has(id)) {
        const dynamicallyImportedIds = this.dynamicallyImportedIds.get(id);
        module.dynamicallyImportedIds = dynamicallyImportedIds
          .map((item) => {
            return this.graph.get(item);
          })
          .filter(Boolean);
      }
      if (this.importers.has(id)) {
        const importers = this.importers.get(id);
        module.importers = importers
          .map((item) => {
            return this.graph.get(item);
          })
          .filter(Boolean);
      }
      if (this.dynamicImporters.has(id)) {
        const dynamicImporters = this.dynamicImporters.get(id);
        module.dynamicImporters = dynamicImporters
          .map((item) => {
            return this.graph.get(item);
          })
          .filter(Boolean);
      }
      if (this.bundle.originModules.has(id)) {
        module.removedExports =
          this.bundle.originModules.get(id).removedExports;
        module.renderedExports =
          this.bundle.originModules.get(id).renderedExports;
      }
    });
  }
  /** 分析并标记循环依赖 */
  analysisCircleModule(
    entryId: string = this.entryId,
    matchModules: Module[] | null = null,
  ) {
    if (this.graph.has(entryId)) {
      // 发现循环依赖
      if (
        matchModules &&
        matchModules.length &&
        ModuleGraph.hasDuplicate(matchModules)
      ) {
        const circleModule = ModuleGraph.getDuplicate(matchModules);
        if (circleModule) {
          const firstModules = ModuleGraph.subarrayFromFirstMatch(
            circleModule,
            matchModules,
          );
          const key = firstModules.map((it) => it.id).join("&");

          // 去重
          if (!circleModule.circleModules.has(key))
            circleModule.circleModules.set(key, firstModules);
        }
        // logCircleModules(circleModule.circleModules)
        return;
      }
      const rootModule = this.graph.get(
        matchModules && matchModules.length
          ? matchModules[matchModules.length - 1].id
          : entryId,
      );
      const importedIds = rootModule.importedIds;
      const dynamicallyImportedIds = rootModule.dynamicallyImportedIds;
      const allImportedIds = [...importedIds, ...dynamicallyImportedIds];
      // 多叉树深度优先遍历
      allImportedIds.forEach((module) => {
        this.analysisCircleModule(
          entryId,
          matchModules ? [...matchModules, module] : [rootModule, module],
        );
      });
    }
  }
  /** 收集函数粒度更改影响的文件 */
  collectedEntryAndExportToFileNames(
    entryId: string,
    changeExports: string[],
    path: string[],
  ) {
    changeExports.forEach((exportName) => {
      path.slice(0, -1).forEach((id) => {
        const fullId = this.rootId + id;

        if (this.entryIdAndExportToFileNames.has(`${entryId}//${exportName}`)) {
          this.entryIdAndExportToFileNames
            .get(`${entryId}//${exportName}`)
            .add(fullId);
        } else {
          this.entryIdAndExportToFileNames.set(
            `${entryId}//${exportName}`,
            new Set([fullId]),
          );
        }
      });
    });
  }
  /**初始化树节点 */
  initTreeNodeData(entryId: string, parent: ModuleTree) {
    let id = entryId;
    if (this._moduleIds.has(entryId)) {
      const newValue = this._moduleIds.get(entryId) + 1;
      this._moduleIds.set(entryId, newValue);
      id = `${newValue}`;
    } else {
      this._moduleIds.set(entryId, 1);
      id = `1`;
    }
    const nameArr = entryId.split("/");
    const exportEffect = this.bundle.allExportEffected
      .get(entryId)
      ?.getSerializableNode();

    const tree: ModuleTree = {
      parentId: parent ? `${parent.pathId}-${parent.id}` : undefined,
      id: id,
      pathId: entryId.slice(this.rootId.length) || entryId, // 1. 去掉根目录 2. 虚拟模块可能不存在真实路径
      depth: parent ? parent.depth + 1 : 0,
      name: nameArr
        .slice(nameArr.length >= 2 ? nameArr.length - 2 : 0)
        .join("/"),
      children: [],
      idpath: parent ? [...parent.idpath, id] : [id],
      // circleIds: [],
      path: parent
        ? [...parent.path, entryId.slice(this.rootId.length)]
        : [entryId.slice(this.rootId.length)],
      removedExports: [],
      renderedExports: [],
      isGitChange: Boolean(exportEffect?.isGitChange),
      isImportChange: Boolean(exportEffect?.isImportChange),
      isSideEffectChange: Boolean(exportEffect?.isSideEffectChange),
      exportEffectedNamesToReasons: exportEffect
        ? exportEffect.exportEffectedNamesToReasons
        : {},
      importEffectedNames: exportEffect ? exportEffect.importEffectedNames : {},
    };
    return tree;
  }
  transform(
    entryId: string = this.entryId,
    depth: number = 9999,
    parent: ModuleTree | null = null,
  ): ModuleTree | null {
    const tree: ModuleTree = this.initTreeNodeData(entryId, parent);
    const changedExports = Object.keys(tree.exportEffectedNamesToReasons);
    if (changedExports.length > 0) {
      this.collectedEntryAndExportToFileNames(
        entryId,
        changedExports,
        tree.path,
      );
    }

    if (!parent) tree.rootId = this.rootId;

    if (this.graph.has(entryId)) {
      const rootModule = this.graph.get(entryId);
      tree.removedExports = rootModule.removedExports;
      tree.renderedExports = rootModule.renderedExports;
      // depth = 0 停止向下遍历
      if (depth === 0) return tree;
      // 发现循环路径
      if (new Set(tree.path).size !== tree.path.length) {
        return tree;
      }
      // 遍历导入模块
      tree.children = rootModule.importedIds
        .concat(rootModule.dynamicallyImportedIds)
        .map((module) => {
          let kid: ModuleTree | null = null;
          kid = this.transform(module.id, depth - 1, tree);
          if (kid) {
            kid.parentId = `${tree.pathId}-${tree.id}`;
            kid.depth = tree.depth + 1;
            kid.path = [...tree.path, kid.pathId];
            kid.idpath = [...tree.idpath, kid.id];
          }
          return kid;
        })
        .filter(Boolean);
      return tree;
    }
    return tree;
  }
  private tileTree(tree: ModuleTree) {
    tree.children.forEach((child) => {
      this.tileTree(child);
    });
    this.tiledTree.push({ ...tree, children: [] });
  }
  /** 生成铺平的树 */
  generateTiledTreeByRootId(entryId: string = this.entryId) {
    if (this.graph.has(entryId)) {
      const rootTree = this.transform(entryId);
      this.tileTree(rootTree);
      return this.tiledTree;
    }
    return null;
  }
  stringifyTreeByRootId(entryId: string = this.entryId) {
    if (this.graph.has(entryId)) {
      const rootTree = this.transform(entryId);
      return JSON.stringify(rootTree, null, 2);
    }
    return "";
  }
}
// 整合vite的打包后的整体信息
export class Bundle {
  /** 项目入口 */
  entry: string;
  /** 模块图 */
  moduleGraph: ModuleGraph;
  /** 实际打包模块 */
  originModules = new Map<
    string,
    {
      removedExports: string[];
      renderedExports: string[];
    }
  >();
  /** 该项目所有的importId */
  allModules = new Map<string, ModuleInfo | null>();

  // options: PluginConfig;
  allExportEffected: Map<string, ExportEffectedNode>;

  constructor(entry: string) {
    this.entry = entry;
  }

  /** 获取实际被打包的模块 */
  resolveOriginModuleByBundle(fn: (originModules: Map<string, any>) => void) {
    fn(this.originModules);
  }
  /** 从项目入口收集项目的全部的importId */
  generateModuleGraph(getModuleInfo: GetModuleInfo) {
    const allModules = this.collectAllModules(this.entry, getModuleInfo);
    this.moduleGraph = new ModuleGraph(this, this.entry, allModules);
    return this.moduleGraph;
  }
  // 搜集项目所有的引入模块的信息，包括动态引入
  private collectAllModules(importId: string, getModuleInfo: GetModuleInfo) {
    const info = getModuleInfo(importId);
    this.allModules.set(importId, info);
    [
      ...(info?.importedIds || []),
      ...(info?.dynamicallyImportedIds || []),
    ].forEach((id) => {
      /*
        1. 以allExportEffected为准
        2. 排出三方包
        3. 排除已经搜集过的importId的
      */
      if (
        !this.allExportEffected.has(id) ||
        idInExternals(id) ||
        this.allModules.has(id)
      ) {
        return;
      }
      // 递归搜集子importId
      this.collectAllModules(id, getModuleInfo);
    });
    return this.allModules;
  }
}
