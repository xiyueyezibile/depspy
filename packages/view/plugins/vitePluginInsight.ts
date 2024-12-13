
import { Plugin } from "vite";



const externals = ["node_modules", "css", "sass", "less"]

function idInExternals(id: string) {
  return externals.some((external) => id.includes(external))
}

class Module {
  id: string;
  /** key的导入者value */
  importers: Module[] = [];
  dynamicImporters: Module[] = [];
  /** key导入value */
  importedIds: Module[] = [];
  dynamicallyImportedIds: Module[] = [];
  circleModules: Module[] | null = null;
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
  rootId: string;
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
  analyseCircleModule(rootId: string = this.rootId, matchModules: Module[] | null = null) {
    if(this.graph.has(rootId)) {
        // 发现循环依赖
        if(matchModules && matchModules.length && ModuleGraph.hasDuplicate(matchModules)) {
            const circleModule = ModuleGraph.getDuplicate(matchModules)
            if(circleModule) circleModule.circleModules = ModuleGraph.subarrayFromFirstMatch(circleModule, matchModules)
            console.log('start',circleModule.circleModules[0]);
            
            return
        }
        const rootModule = this.graph.get(matchModules && matchModules.length? matchModules[matchModules.length - 1].id :rootId);
        const importedIds = rootModule.importedIds;
        const dynamicallyImportedIds = rootModule.dynamicallyImportedIds;
        const allImportedIds = [...importedIds, ...dynamicallyImportedIds];
        // 多叉树深度优先遍历
        allImportedIds.forEach(module => {
            
            this.analyseCircleModule(rootId, matchModules ? [...matchModules, module] : [rootModule, module])
        })
    }
  }
  genarateTreeByRootId(rootId: string = this.rootId) {
    if(this.graph.has(rootId)) {
        const rootModule = this.graph.get(rootId);
    }
  }
}

class Bundle {
  moduleGraph: ModuleGraph;
  /** 实际打包模块 */
  originModules = new Map<string, any>();
  /** 加载模块 */
  loadModules = new Map<string, any>();
  
  
  constructor() {
  }
  /** 获取实际被打包的模块 */
  resolveOriginModuleByBundle(bundle) {
    const distLists = Object.values(bundle);
    distLists.forEach((dist) => {
      Object.entries(dist["modules"] || {}).forEach(([id, data]) => {
        this.originModules.set(id, data)
      });
    });
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
        }
    })
    return result;
  }
  /** 根据map生产moduleGraph */
  newModuleByMap(map: Record<string, any>) {
    this.moduleGraph = new ModuleGraph(this,map);
  }

}

export function vitePluginInsight(options: {
    root?: string;
}): Plugin {
    /** 全局保存 */
  let globleBundle: Bundle;
  return {
    name: "vite-plugin-insight",
    configResolved() {
        // 初始化
      globleBundle = new Bundle();
    },
    load(id) {
      globleBundle.resolveLoadModule(id);
    },
    generateBundle(_, bundle) {
        
      // 根据bundle获取实际被打包的模块
      globleBundle.resolveOriginModuleByBundle(bundle);
      const map = globleBundle.findLoadModuleWithOriginModule();
      globleBundle.newModuleByMap(map);
      
        // 拿到moduleGraph
      const moduleGraph = globleBundle.moduleGraph;
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
      moduleGraph.analyseCircleModule(options.root)
    },
  };
}
