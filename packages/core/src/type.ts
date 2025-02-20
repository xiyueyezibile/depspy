export interface Node {
  name: string;
  version: string;
  declarationVersion: string;
  path: string[];
  realNamePath: string[];
  childrenNumber: number;
  resolvePath: string;
  description?: string;
  cache?: string;
  circlePath?: string[];
  dependencies: Record<string, Node>;
  dependenciesList: Record<string, string>;
  size?: number;
  selfSize: number;
}
export interface StaticNode {
  path: string;
  resolvedPath: string;
  imports: string[];
  exports: string[];
  dependencies: Record<string, StaticNode>;
}
export interface Config {
  depth?: number;
  size?: boolean;
  entry?: string;
  output?: {
    graph?: string;
    staticGraph?: string;
    circularDependency?: string;
    codependency?: string;
  };
}
export interface ExportEffectedNodeSerializable {
  isImportChange: boolean;
  isSideEffectChange: boolean;
  isGitChange: boolean;
  exportEffectedNamesToReasons: {
    [key: string]: {
      isNativeCodeChange: boolean;
      importEffectedNames: { [key: string]: string[] };
    };
  };
  importEffectedNames: { [key: string]: string[] };
}

export type Values<T> = T[keyof T];

export type ModuleInfo = {
  // 该文件静态引入的绝对路径
  importedIds: string[];
  // 该文件动态引入的绝对路径
  dynamicallyImportedIds: string[];
  // 该文件哪些导出没用被使用
  removedExports: string[];
  // 该文件哪些导出被使用
  renderedExports: string[];
};
export type GetModuleInfo = (importId: string) => ModuleInfo;

export interface PluginDepSpyConfig {
  // 项目的入口，默认为index.html
  entry?: string;
  // 忽略的文件路径，正则用test，字符串用includes
  ignores?: (string | RegExp)[];
  // 对比版本的commit hash
  commitHash?: string;
  // 忽略的插件名字
  ignorePlugins?:string[]
}
