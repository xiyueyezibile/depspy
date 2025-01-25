import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

interface Config {
  root: string;
  entry?: string;
  pkgPath?: string;
}

const externals = ["node_modules"];

function idInExternals(id: string) {
  return externals.some((external) => {
    // if(id.includes(external)) console.log(id);

    return id.includes(external);
  });
}

function getExternalName(id: string) {
  if (!idInExternals(id)) return id;
  const arr = id.split(path.sep);
  const i = arr.findIndex((item) => item === "node_modules");
  const name = arr[i + 1] === ".pnpm" ? arr[i + 2] : arr[i + 1];
  return name;
}

function logCircleModules(circleModules: Module[]) {
  const str = circleModules.map((module) => module.id).join(" -> ");
  console.log(`Circular dependency detected: ${str}`);
}

interface ModuleTree {
  children?: ModuleTree[];
  parentId?: string;
  id: string;
  pathId: string;
  name: string;
  // circleIds: string[][]
  depth: number;
  path: string[];
  idpath: string[];
}

class Module {
  id: string;
  /** key的导入者value */
  importers: Module[] = [];
  dynamicImporters: Module[] = [];
  /** key导入value */
  importedIds: Module[] = [];
  dynamicallyImportedIds: Module[] = [];
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
  private _moduleIds = new Map<string, number>();
  constructor(bundle: Bundle, map: Record<string, any>) {
    this.bundle = bundle;
    Object.entries(map).forEach(([key, value]) => {
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
    this.graph.forEach((module, key) => {
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
    });
  }
  /** 分析并标记循环依赖 */
  analyseCircleModule(
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
        this.analyseCircleModule(
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
    const nameArr = entryId.split(path.sep);
    const tree: ModuleTree = {
      parentId: parent ? `${parent.pathId}-${parent.id}` : undefined,
      id: id,
      pathId: entryId,
      depth: parent ? parent.depth + 1 : 0,
      name: nameArr
        .slice(nameArr.length >= 2 ? nameArr.length - 2 : 0)
        .join(path.sep),
      children: [],
      idpath: parent ? [...parent.idpath, id] : [id],
      // circleIds: [],
      path: parent ? [...parent.path, entryId] : [entryId],
    };

    // depth = 0 停止向下遍历
    if (depth === 0) return tree;
    // 发现循环路径
    if (new Set(tree.path).size !== tree.path.length) {
      return tree;
    }

    if (this.graph.has(entryId)) {
      const rootModule = this.graph.get(entryId);

      // 遍历导入模块
      tree.children = rootModule.importedIds
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
  genarateTreeByRootId(entryId: string = this.entryId) {
    if (this.graph.has(entryId)) {
      const rootModule = this.graph.get(entryId);
      return rootModule;
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

class Bundle {
  moduleGraph: ModuleGraph;
  /** 实际打包模块 */
  originModules = new Map<string, any>();
  /** 加载模块 */
  loadModules = new Map<string, any>();
  noBundleModules = new Map<string, any>();
  /** 外部模块 */
  externalModules = new Map<string, any>();
  /** 实际外部模块 */
  originExternalModules = new Map<string, any>();
  unUsedExternalModules = new Map<string, any>();
  options: Config;
  externals = [];
  constructor(options: Config) {
    this.options = options;
    if (options.pkgPath) {
      const pkg = readFileSync(options.pkgPath, "utf-8");
      const pkgJson = JSON.parse(pkg);

      this.externals = [
        ...Object.keys(pkgJson.dependencies || []),
        ...Object.keys(pkgJson.devDependencies || []),
      ];
    }
    const jsonName = "moduleTree.json";
    const jsonPath = path.join(options.root, jsonName);
    if (!existsSync(jsonPath))
      writeFileSync(jsonPath, JSON.stringify([], null, 2));
  }

  /** 获取实际被打包的模块 */
  resolveOriginModuleByBundle(
    fn: (
      originModules: Map<string, any>,
      originExternalModules: Map<string, any>,
      externals: string[],
    ) => void,
  ) {
    fn(this.originModules, this.originExternalModules, this.externals);
  }
  /** 获取编译阶段模块 */
  resolveLoadModule(id: string) {
    if (!idInExternals(id)) {
      this.loadModules.set(id, id);
    } else {
      const externalArr = getExternalName(id).split("@");
      const externalName =
        externalArr.length === 3
          ? externalArr[0] + "@" + externalArr[1]
          : externalArr[0];
      if (this.externals.includes(externalName))
        this.externalModules.set(getExternalName(id), getExternalName(id));
    }
  }
  /** 寻找在编译模块和实际模块都存在的模块 */
  findLoadModuleWithOriginModule() {
    const result = {};
    const externalResult = {};

    this.loadModules.forEach((module, id) => {
      if (this.originModules.has(id)) {
        result[id] = this.originModules.get(id);
      } else {
        this.noBundleModules.set(id, module);
      }
    });
    this.externalModules.forEach((module, id) => {
      if (this.originExternalModules.has(id)) {
        externalResult[id] = this.originExternalModules.get(id);
      } else {
        this.unUsedExternalModules.set(id, module);
      }
    });
    console.log(Object.keys(externalResult));

    return {
      modules: result,
      externalModules: externalResult,
    };
  }
  /** 根据map生产moduleGraph */
  newModuleByMap(map: Record<string, any>) {
    this.moduleGraph = new ModuleGraph(this, map.modules);
  }
}

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
        (originModules, originExternalModules, externals) => {
          const distLists = Object.values(bundle);
          distLists.forEach((dist) => {
            Object.entries(dist["modules"] || {}).forEach(([id, data]) => {
              if (!idInExternals(id)) {
                originModules.set(id, data);
              } else {
                const externalArr = getExternalName(id).split("@");
                const externalName =
                  externalArr.length === 3
                    ? externalArr[0] + "@" + externalArr[1]
                    : externalArr[0];
                if (externals.includes(externalName))
                  originExternalModules.set(getExternalName(id), [
                    ...(originExternalModules.get(getExternalName(id)) || []),
                    data,
                  ]);
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
