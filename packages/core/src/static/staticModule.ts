import { jsonsToBuffer } from "@dep-spy/utils";
import http from "http";
import { ExportEffectedNode } from "./getAllExportEffected";
import { getGitRootPath } from "./utils";
import { PluginConfig } from "./vitePluginInsight";

export const externals = ["node_modules"];

export function idInExternals(id: string) {
  return externals.some((external) => {
    return id.includes(external);
  });
}

function logCircleModules(circleModules: Module[]) {
  const str = circleModules.map((module) => module.id).join(" -> ");
  console.log(`Circular dependency detected: ${str}`);
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
  changedExports: string[];
  // 该文件的哪些导入有改动, 例如 { './a': ['a','default'] }
  changedImports: {
    [source: string]: string[];
  };
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
  constructor(bundle: Bundle, map: Record<string, any>) {
    this.bundle = bundle;
    this.rootId = getGitRootPath();
    // 绝对路径=>模块节点的映射（现在还是空壳）
    Object.entries(map).forEach(([key]) => {
      this.graph.set(key, new Module(key));
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
  transform(
    entryId: string = this.entryId,
    depth: number = 9999,
    parent: ModuleTree | null = null,
  ): ModuleTree | null {
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
    const exportEffect = this.bundle.allExportEffected.get(entryId);

    const tree: ModuleTree = {
      parentId: parent ? `${parent.pathId}-${parent.id}` : undefined,
      id: id,
      pathId: entryId.slice(this.rootId.length), // 去掉根目录
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
      changedExports: exportEffect
        ? Array.from(exportEffect.exportEffectedNames)
        : [],
      changedImports: Array.from(
        exportEffect?.importEffectedNames.entries() || [],
      ).reduce((pre, [key, value]) => {
        // map转对象
        return {
          ...pre,
          [key]: Array.from(value),
        };
      }, {}),
    };

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
  }
}

export function postServerGraph(data: ModuleTree[]) {
  const options = {
    hostname: "localhost",
    port: 2025,
    path: "/collectBundle",
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
  };
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let chunks = [];
      res.on("data", (chunk) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve(Buffer.concat(chunks).toString());
      });
    });

    req.on("error", (error) => {
      reject(error);
    });
    req.write(jsonsToBuffer(data.map((item) => JSON.stringify(item))));
    req.end();
  });
}

export class Bundle {
  moduleGraph: ModuleGraph;
  /** 实际打包模块 */
  originModules = new Map<
    string,
    {
      removedExports: string[];
      renderedExports: string[];
    }
  >();
  /** 加载模块 */
  loadModules = new Map<string, any>();
  noBundleModules = new Map<string, any>();

  options: PluginConfig;
  allExportEffected: Map<string, ExportEffectedNode>;

  constructor(options: PluginConfig) {
    this.options = options;
  }

  /** 获取实际被打包的模块 */
  resolveOriginModuleByBundle(fn: (originModules: Map<string, any>) => void) {
    fn(this.originModules);
  }
  /** 获取编译阶段模块 */
  resolveLoadModule(id: string) {
    if (!idInExternals(id)) {
      this.loadModules.set(id, id);
    }
  }
  /** 寻找在编译模块和实际模块都存在的模块 */
  findLoadModuleWithOriginModule() {
    const result = {};

    this.loadModules.forEach((module, id) => {
      if (this.originModules.has(id)) {
        result[id] = this.originModules.get(id);
      } else {
        this.noBundleModules.set(id, module);
      }
    });

    return {
      modules: result,
    };
  }
  /** 根据map生产moduleGraph */
  newModuleByMap(map: Record<string, any>) {
    this.moduleGraph = new ModuleGraph(this, map.modules);
  }
}
