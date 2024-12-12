
import { Plugin } from "vite";



class Module {
  id: string;
  /** key的导入者value */
  importers: Module[] = [];
  dynamicImporters: Module[] = [];
  /** key导入value */
  importedIds: Module[] = [];
  dynamicallyImportedIds: Module[] = [];
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
  constructor(bundle: Bundle,map: Record<string, any>) {
    this.bundle = bundle;
    Object.entries(map).forEach(([key, value]) => {
        this.graph.set(key, new Module(key))
    })
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
  resolveOriginModuleByBundle(bundle, v) {
    const distLists = Object.values(bundle);
    distLists.forEach((dist) => {
      Object.entries(dist["modules"] || {}).forEach(([id, data]) => {
        this.originModules.set(id, data)
      });
    });
  }
  /** 获取编译阶段模块 */
  resolveLoadModule(id: string) {
    if (!id.includes("node_modules")) {
        
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

export function vitePluginInsight(): Plugin {
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
      globleBundle.resolveOriginModuleByBundle(bundle, this);
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
      console.log(moduleGraph.graph);
      
    },
  };
}
