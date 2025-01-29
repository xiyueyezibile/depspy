// 源码路径和绝对路径的互相映射
export class SourceToImportId {
  // 引用者绝对路径//相对=>绝对路径的映射，ps: {"/user/code/b.js//./a":"/user/code/a.js"}
  private sourceToImportIdMap: Map<string, string>;
  // 绝对路径<=>裸导入的映射，ps: {lodash:"/user/code/lodash/index.js"}
  private bareImportToImportIdMap: Map<string, string>;
  constructor() {
    this.sourceToImportIdMap = new Map();
    this.bareImportToImportIdMap = new Map();
  }
  // 保存源码路径和绝对路径的关联
  addRecord(source: string, importer: string | undefined, importId: string) {
    const key = this.getKey(source, importer);
    if (this.isBareImport(source)) {
      this.bareImportToImportIdMap.set(importId, key);
      return this.bareImportToImportIdMap.set(key, importId);
    }
    return this.sourceToImportIdMap.set(key, importId);
  }
  // 通过源码路径获取绝对路径
  getImportIdBySource(source: string, importer: string) {
    const key = this.getKey(source, importer);
    if (this.isBareImport(source)) {
      return this.bareImportToImportIdMap.get(key);
    }
    return this.sourceToImportIdMap.get(key);
  }
  // 构造不同的key
  private getKey(source: string, importer: string | undefined) {
    // 三方包路径/别名/绝对路径，直接以source为key
    if (this.isBareImport(source)) {
      return source;
    }
    // 相对路径需要加上引用地址才能作为唯一id
    return `${source}//${importer || ""}`;
  }
  // 是否是裸导出
  private isBareImport(source: string) {
    if (!source.startsWith("./") && !source.startsWith("../")) {
      return true;
    }
    return false;
  }
}
