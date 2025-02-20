import path from "path";
import crypto from "crypto";
import { simple } from "acorn-walk";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { jsonsToBuffer } from "@dep-spy/utils";
import http from "http";
import { ExportEffectedNodeSerializable, PluginDepSpyConfig } from "../type";
import { DEP_SPY_COMMIT_HASH, DEP_SPY_INJECT_MODE } from "../constant";

// 源码路径和绝对路径的互相映射
export class SourceToImportId {
  // 引用者绝对路径//相对=>绝对路径的映射，ps: {"/user/code/b.js//./a":"/user/code/a.js"}
  sourceToImportIdMap: Map<string, string>;
  // 绝对路径<=>裸导入的映射，ps: {lodash:"/user/code/lodash/index.js"}
  bareImportToImportIdMap: Map<string, string>;
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
    // 相对路径需要加上引用地址才能作为唯一id(以//为分隔符)
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

// 更方便的合并添加节点的影响
export class ExportEffectedNode {
  // 受影响的导出以及对应影响原因，key:导出名称（例如：default ，* ，xx ），value: 影响原因
  exportEffectedNamesToReasons: Map<
    string,
    {
      // 是否是因为本地代码变更导致的导出变更
      isNativeCodeChange?: boolean;
      // 是否是因为引入变更导致的导出变更，例如：{ "/user/code/a.ts": ["a","default"] }
      // 和下面的importEffectedNames类型一致，只不过只是针对某个导出的依赖引入
      importEffectedNames: Map<string, Set<string>>;
    }
  >;
  // 受影响的导入,例如：{ "/user/code/a.ts": ["a","b","default","*"] }
  importEffectedNames: Map<string, Set<string>>;
  // 是否有代码变更
  isGitChange?: boolean;
  // 是否有导入变更
  isImportChange?: boolean;
  // 是否有副作用变更
  isSideEffectChange?: boolean;
  constructor() {
    this.exportEffectedNamesToReasons = new Map();
    this.importEffectedNames = new Map();
  }
  // 添加导出影响以及原因（深度合并）
  addExportEffectedNameToReason(
    exportName: string,
    reason: {
      isNativeCodeChange?: boolean;
      importEffectedNames?: Map<string, Set<string>>;
    },
  ) {
    const { isNativeCodeChange = false, importEffectedNames = new Map() } =
      reason;
    /* 如果存在该exportName，则深度合并传入数据和已有数据, 例如:
     { "a": { isNativeCodeChange: false, importEffectedNames: { "/user/b.ts": ["b1"] } } }} 
      + { "a": { isNativeCodeChange: true, importEffectedNames: { "/user/b.ts": ["b2"] } } }}
      => { "a": { isNativeCodeChange: true, importEffectedNames: { "/user/b.ts": ["b1","b2"] } } }
    */
    // 如果存在该exportName，则深度合并传入数据和已有数据
    if (this.exportEffectedNamesToReasons.has(exportName)) {
      const exportEffectedReason =
        this.exportEffectedNamesToReasons.get(exportName);
      exportEffectedReason.isNativeCodeChange = isNativeCodeChange;
      importEffectedNames.forEach((value, key) => {
        const importEffectedName =
          exportEffectedReason.importEffectedNames.get(key);
        if (importEffectedName) {
          value.forEach((v) => {
            importEffectedName.add(v);
          });
        } else {
          exportEffectedReason.importEffectedNames.set(key, value);
        }
      });
      return;
    }
    // 不存在该exportName，且参数有意义，则新增
    if (isNativeCodeChange || importEffectedNames.size) {
      this.exportEffectedNamesToReasons.set(exportName, {
        isNativeCodeChange,
        importEffectedNames,
      });
    }
  }
  // 记录有变化的导入
  addImportEffectedName(importId: string, importName: string) {
    // 存在该导入，直接添加importName
    if (this.importEffectedNames.has(importId)) {
      this.importEffectedNames.get(importId)?.add(importName);
      return;
    }
    // 不存在该导入，新增Set记录
    this.importEffectedNames.set(importId, new Set([importName]));
  }
  // 将本节点的属性转化为可序列化的对象,主要是Map转对象，Set转数组
  getSerializableNode() {
    return deepClone({
      isImportChange: this.isImportChange,
      isGitChange: this.isGitChange,
      isSideEffectChange: this.isSideEffectChange,
      exportEffectedNamesToReasons: this.exportEffectedNamesToReasons,
      importEffectedNames: this.importEffectedNames,
    }) as unknown as ExportEffectedNodeSerializable;
  }
}

// 规范化vite插件中的id
export function normalizeIdToFilePath(id: string) {
  if (id) {
    const pathWithoutQuery = id.split("?")[0];
    return pathWithoutQuery.replace(/\x00/g, "");
  }
  return id;
}

// 通过字符串获取hash值
export function getHashFromString(input: string) {
  return crypto.createHash("md5").update(input).digest("hex");
}

// 获取AST中的导入对应关系，比如import {a,b as c} from 'xxx'，则返回{xxx:[a,b]}
export function findSourceToImportsFormAst(
  ast?: Parameters<typeof simple>["0"] | null,
) {
  const sourceToImports: Map<string, Set<string>> = new Map();
  // 如果没有AST，直接返回
  if (!ast) {
    return sourceToImports;
  }
  simple(ast, {
    ImportDeclaration(node) {
      const source = String(node.source.value);
      const specifiers = node.specifiers;
      // 确保source对应的Set存在
      function ensureSet(value: string) {
        if (sourceToImports.get(source)) {
          sourceToImports.get(source)?.add(value);
        } else {
          sourceToImports.set(source, new Set([value]));
        }
      }
      specifiers.forEach((specifier) => {
        if (specifier.type === "ImportDefaultSpecifier") {
          // 处理默认导入
          ensureSet("default");
        } else if (specifier.type === "ImportNamespaceSpecifier") {
          // 处理命名空间导入
          ensureSet("*");
        } else if (specifier.type === "ImportSpecifier") {
          // 处理具名导入
          if (specifier.imported.type === "Identifier") {
            ensureSet(specifier.imported.name);
          } else {
            ensureSet(String(specifier.imported.value));
          }
        }
      });
    },
  });
  return sourceToImports;
}

// 获取指定版本的提交内容
export function getFileContentAtCommit(
  absolutePath: string,
  commitHash: string,
) {
  absolutePath = normalizeIdToFilePath(absolutePath);
  try {
    const gitRootPath = getGitRootPath();
    // 构建 Git 命令
    const command = `git show ${commitHash}:${path.relative(
      gitRootPath,
      absolutePath,
    )}`;
    // 同步执行 Git 命令
    const output = execSync(command);
    // 将输出转换为字符串并返回
    return output.toString();
  } catch (error) {
    return "";
  }
}

// 通过vite的id规范判读一个文件路径是不是commonjs规范
export function isCommonJsById(importId: string) {
  const query = importId.split("?")?.[1] || "";
  return query.includes("commonjs");
}

// 通过vite的id安全的获取当前真实文件源码
export function readFileSyncSafe(id: string) {
  const filePath = normalizeIdToFilePath(id);
  let code = "";
  try {
    code = readFileSync(filePath, { encoding: "utf-8" });
  } catch (e) {
    console.error(`路径:${filePath}读取失败`, e);
  }
  return code;
}

// 通过git判断文件是否修改
export function isGitFileModified(filePath: string) {
  try {
    const output = execSync(
      `git status --porcelain ${normalizeIdToFilePath(filePath)}`,
    ).toString();
    if (output) {
      return true;
    }
  } catch (e) {
    return true;
  }
  return false;
}

// 通过git查询仓库根目录
export function getGitRootPath() {
  try {
    return execSync("git rev-parse --show-toplevel").toString().trim();
  } catch {
    return process.cwd();
  }
}

// 分块逻辑
export async function sendDataByChunk(data: any[], path: string) {
  const chunkLen = 80;
  // 分块发送数据给服务器
  const count = Math.ceil(data?.length / chunkLen);
  try {
    await Promise.all(
      new Array(count).fill(0).map((_, i) => {
        // 最后一个分块携带标记，表示发送完毕
        const pathWithQuery = i + 1 < count ? path : `${path}?end=${count}`;
        return postServerGraph(
          data.slice(i * chunkLen, (i + 1) * chunkLen),
          pathWithQuery,
        );
      }),
    );
  } catch (error) {
    console.log("数据发送失败:", error);
  }
}
// 发送数据逻辑
export function postServerGraph(data: any[], path: string) {
  const options = {
    hostname: "localhost",
    port: 2025,
    path,
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
  };
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
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
    // 如果是注入模式，直接发送字符串
    if (process[DEP_SPY_INJECT_MODE]) {
      req.write(data.map((item) => JSON.stringify(item)));
    } else {
      req.write(jsonsToBuffer(data.map((item) => JSON.stringify(item))));
    }


    req.end();
  });
}

// 缓存高消耗的函数结果
export function cacheReturn<T extends (...args: any) => any>(
  callback: T,
  createKey: (...args: Parameters<T>) => string,
) {
  const cache = new Map();
  async function fn(...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
    const key = createKey(...args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const value = callback.apply(this, args);
    cache.set(key, value);
    return value;
  }
  return fn;
}

// 判断文件是否需要过滤
export function isPathNeedFilter(
  path: string,
  ignores: (string | RegExp)[] = [],
) {
  // 遍历正则表达式数组
  return ignores.some((reg) => {
    if (reg instanceof RegExp) {
      return reg.test(path);
    }
    if (typeof reg === "string") {
      return path.includes(reg);
    }
    return true;
  });
}

// 将嵌套的Map或者Set转化为可序列化的对象或者数组
export function deepClone<T>(target: T): T {
  const map = new WeakMap();
  const stack = new Set<unknown>();

  function isObject(obj: unknown): obj is object {
    return typeof obj === "object" && obj !== null;
  }

  function cloneData(data: unknown): unknown {
    if (!isObject(data)) return data;

    if (stack.has(data)) {
      throw new Error("Cannot clone object with circular reference");
    }
    stack.add(data);
    const exist = map.get(data);
    if (exist) return exist;
    if (data instanceof Map) {
      const result = {};
      map.set(data, result);
      data.forEach((value, key) => {
        result[key] = cloneData(value);
      });
      return result;
    }
    if (data instanceof Set) {
      const result = [];
      map.set(data, result);
      data.forEach((value) => {
        result.push(cloneData(value));
      });
      return result;
    }
    const keys = Reflect.ownKeys(data);
    const allDesc = Object.getOwnPropertyDescriptors(data);
    const result = Object.create(Object.getPrototypeOf(data), allDesc);
    map.set(data, result);
    keys.forEach((key: PropertyKey) => {
      const value = data[key as keyof typeof data];
      result[key] = isObject(value) ? cloneData(value) : value;
    });
    stack.delete(data);
    return result;
  }
  return cloneData(target) as T;
}

// 合并环境配置和插件配
export function mergeOptions(options: PluginDepSpyConfig): PluginDepSpyConfig {
  return {
    commitHash: process.env[DEP_SPY_COMMIT_HASH],
    ...options,
  }
}