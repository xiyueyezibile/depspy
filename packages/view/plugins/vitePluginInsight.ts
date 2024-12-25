
import { existsSync, unlinkSync, writeFileSync } from "fs";
import path from 'path'
import { Plugin } from "vite";



interface Config {
  root: string;
  entry?: string;
}

const externals = ["node_modules", "css", "sass", "less"]

function idInExternals(id: string) {
  return externals.some((external) => id.includes(external))
}

function logCircleModules(circleModules: Module[]) {
    const str = circleModules.map((module) => module.id).join(" -> ")
    console.log(`Circular dependency detected: ${str}`)
}

interface ModuleTree {
    children?: ModuleTree[]
    parentId?: string
    id: string
    pathId: string
    name: string
    circleIds: string[][]
    depth: number
    path: string[]
}

class Module {
  id: string;
  /** key的导入者value */
  importers: Module[] = [];
  dynamicImporters: Module[] = [];
  /** key导入value */
  importedIds: Module[] = [];
  dynamicallyImportedIds: Module[] = [];
  circleModules= new Map<string, Module[]>();
  constructor(id: string) {
    this.id = id;
  }
}

class ModuleGraph {
    graph = new Map<string, Module>();
    /** key的导入者value */
  importers = new Map<string,readonly string[]>();
  dynamicImporters = new Map<string,readonly string[]>();
  /** key导入value */
  importedIds = new Map<string,readonly string[]>();
  dynamicallyImportedIds = new Map<string,readonly string[]>();
  bundle: Bundle;
  entryId: string;
  rootId: string;
  private _moduleIds = new Map<string, number>();
  constructor(bundle: Bundle,map: Record<string, any>) {
    this.bundle = bundle;
    Object.entries(map).forEach(([key, value]) => {
        this.graph.set(key, new Module(key))
    })
  }
  /** 是否有重复模块 */
  static hasDuplicate(modules: Module[]) {
    if(!modules || modules.length === 0) return false;
    const ids = modules.map((module) => module.id);
    return new Set(ids).size !== ids.length;
  }
  /** 返回重复模块 */
  static getDuplicate(modules: Module[]): Module | null {
    if(!modules || modules.length === 0) return null;
    const seen = new Set()
    for(const module of modules) {
        if(seen.has(module.id)) return module;
        seen.add(module.id)
    }
    return null
  }
  /** 返回包括该 module 之后的数组 */
  static subarrayFromFirstMatch(module: Module, modules: Module[]) {
    const index = modules.map(i => i.id).indexOf(module.id);
    if(index === -1) return null;
    return modules.slice(index);
  }
  static pathInCirclePath(path: string[], circlePath: string[]) {
    for(let i = 1; i <= circlePath.length; i++) {
        if(path.join('&').endsWith(circlePath.slice(0, i).join('&'))) {
            return true;
        }
    }
    return false
  }
  buildGraph() {
    this.graph.forEach((module, key) => {
        const id = module.id;
        if(this.importedIds.has(id)) {
            const importedIds = this.importedIds.get(id);
            module.importedIds = importedIds.map(item => {
                return this.graph.get(item)
            }).filter(Boolean);
        }
        if(this.dynamicallyImportedIds.has(id)) {
            const dynamicallyImportedIds = this.dynamicallyImportedIds.get(id);
            module.dynamicallyImportedIds = dynamicallyImportedIds.map(item => {
                return this.graph.get(item)
            }
            ).filter(Boolean)
        }
        if(this.importers.has(id)) {
            const importers = this.importers.get(id);
            module.importers = importers.map(item => {
                return this.graph.get(item)
            }).filter(Boolean)
        }
        if(this.dynamicImporters.has(id)) {
            const dynamicImporters = this.dynamicImporters.get(id);
            module.dynamicImporters = dynamicImporters.map(item => {
                return this.graph.get(item)
            }).filter(Boolean)
        }
        
    })
  }
  /** 分析并标记循环依赖 */
  analyseCircleModule(entryId: string = this.entryId, matchModules: Module[] | null = null) {
    if(this.graph.has(entryId)) {
        // 发现循环依赖
        if(matchModules && matchModules.length && ModuleGraph.hasDuplicate(matchModules)) {
            const circleModule = ModuleGraph.getDuplicate(matchModules)
            if(circleModule) {
                const firstModules = ModuleGraph.subarrayFromFirstMatch(circleModule, matchModules)
                const key = firstModules.map(it => it.id).join('&')
                
                // 去重
                if(!circleModule.circleModules.has(key)) circleModule.circleModules.set(key,firstModules)
            }
                // logCircleModules(circleModule.circleModules)
            return
        }
        const rootModule = this.graph.get(matchModules && matchModules.length? matchModules[matchModules.length - 1].id :entryId);
        const importedIds = rootModule.importedIds;
        const dynamicallyImportedIds = rootModule.dynamicallyImportedIds;
        const allImportedIds = [...importedIds, ...dynamicallyImportedIds];
        // 多叉树深度优先遍历
        allImportedIds.forEach(module => {
            
            this.analyseCircleModule(entryId, matchModules ? [...matchModules, module] : [rootModule, module])
        })
    }
  }
  
  transform(entryId: string = this.entryId ,depth: number = 9999, parent: ModuleTree | null = null, circleIds: string[][] = []): ModuleTree | null {
    let id = entryId
    if(this._moduleIds.has(entryId)) {
      const newValue = this._moduleIds.get(entryId) + 1
      this._moduleIds.set(entryId, newValue)
      id = `${entryId}-${newValue}`
    } else {
      this._moduleIds.set(entryId, 1)
      id = `${entryId}-1`
    }
    const tree: ModuleTree = {
        parentId: parent? parent.id : undefined,
        id: id,
        pathId: entryId,
        depth: parent? parent.depth + 1 : 0,
        name: entryId.slice(this.rootId.length),
        children: [],
        circleIds: [],
        path: parent? [...parent.path, entryId]: [entryId],
    }

    // 走到循环节点最后一个进行截断
    if(circleIds.length >= 1 && circleIds.filter(circle => {
        return tree.path.join('&').includes(circle.join('&'))
    }).length) {
        return tree
    }
    // depth = 0 停止向下遍历
    if(depth === 0) return tree
    if(this.graph.has(entryId)) {
        const rootModule = this.graph.get(entryId);
         rootModule.circleModules.forEach(modules => {
            tree.circleIds.push(modules.map(module => module.id))
        })
        // 排除后来的循环模块被先来的循环模块截断的情况
        circleIds.forEach(circle => {
          tree.circleIds = tree.circleIds.filter(item => {
            let i = circle.indexOf(item[0])
            if(i !== -1) {
              let j = 1;
              for(let m = i + 1; m < circle.length; m++) {
                // 出现不一致代表不存在被截断情况，返回
                if(!item[j] || item[j] !== circle[m]) {
                  return true; 
                }
              }
            }
            console.log(circle, item);
            
            return false;
          })
        })

        // 遍历导入模块
        tree.children = rootModule.importedIds.map(module => {
            let kid: ModuleTree | null = null
            kid = this.transform(module.id, depth - 1, tree, [...tree.circleIds, ...circleIds].filter((item) => ModuleGraph.pathInCirclePath(tree.path, item)))
            if(kid) {
                kid.parentId = tree.id
                kid.depth = tree.depth + 1
                kid.path = [...tree.path, kid.pathId]
            }
            return kid
        }).filter(Boolean)
        return tree
    }
    return tree
  }
  genarateTreeByRootId(entryId: string = this.entryId) {
    if(this.graph.has(entryId)) {
        const rootModule = this.graph.get(entryId);
        return rootModule;
    }
    return null
  }
  stringifyTreeByRootId(entryId: string = this.entryId) {
    if(this.graph.has(entryId)) {
        const rootTree = this.transform(entryId);
        return JSON.stringify(rootTree, null, 2)
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
  
  constructor(options: Config) {
    const jsonName = 'moduleTree.json'
    const jsonPath = path.join(options.root,jsonName)
    if(!existsSync(jsonPath)) writeFileSync(jsonPath, JSON.stringify([], null, 2));
  }
  /** 获取实际被打包的模块 */
  resolveOriginModuleByBundle(fn: (originModule: Map<string, any>) => void) {
    fn(this.originModules)
  }
  /** 获取编译阶段模块 */
  resolveLoadModule(id: string) {
    
    if (!idInExternals(id)) {
        
      this.loadModules.set(id, id)
        
    }
  }
  /** 寻找在编译模块和实际模块都存在的模块 */
  findLoadModuleWithOriginModule() {
    const result = {};
    
    this.loadModules.forEach((module,id) => {
        
        if(this.originModules.has(id)) {
            result[id] = this.originModules.get(id);
        } else {
            this.noBundleModules.set(id, module);
        }
    })
    return result;
  }
  /** 根据map生产moduleGraph */
  newModuleByMap(map: Record<string, any>) {
    this.moduleGraph = new ModuleGraph(this,map);
  }

}

export function vitePluginInsight(options: Config): Plugin {
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
      globleBundle.resolveOriginModuleByBundle((originModules) => {
        const distLists = Object.values(bundle);
        distLists.forEach((dist) => {
          Object.entries(dist["modules"] || {}).forEach(([id, data]) => {
            originModules.set(id, data)
          });
        });
      });
      const map = globleBundle.findLoadModuleWithOriginModule();
      globleBundle.newModuleByMap(map);
      
        // 拿到moduleGraph
      const moduleGraph = globleBundle.moduleGraph;
      moduleGraph.rootId = options.root;
      moduleGraph.entryId = options.entry;
        // 获取所以导入导出关系
      Object.keys(map).forEach((id) => {
        const info = this.getModuleInfo(id);
        if(info) {
            moduleGraph.importers.set(info.id, info.importers)
            moduleGraph.importedIds.set(info.id, info.importedIds)
            moduleGraph.dynamicImporters.set(info.id, info.dynamicImporters)
            moduleGraph.dynamicallyImportedIds.set(info.id, info.dynamicallyImportedIds)
        }
      })
      /** 根据导入导出关系构建模块依赖图 */
      moduleGraph.buildGraph();
      moduleGraph.analyseCircleModule(options.entry)
      const jsonName = 'moduleTree.json'
      const jsonPath = path.join(options.root,jsonName)
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
