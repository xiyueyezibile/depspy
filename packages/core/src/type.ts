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
