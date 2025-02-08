import path from "path";
import crypto from "crypto";
import { simple } from "acorn-walk";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { jsonsToBuffer } from "@dep-spy/utils";
import http from "http";

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

// 规范化vite插件中的id
export function normalizeIdToFilePath(id: string) {
  const pathWithoutQuery = id.split("?")[0];
  return path.normalize(pathWithoutQuery);
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
  try {
    const gitRootPath = execSync("git rev-parse --show-toplevel")
      .toString()
      .trim();
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

// 通过vite的id安全的获取当前真实文件源码
export function readFileSyncSafe(id: string) {
  const filePath = normalizeIdToFilePath(id);
  let code = "";
  try {
    code = readFileSync(filePath, { encoding: "utf-8" });
  } catch {
    console.error(id, "对应id不存在");
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
export async function sendDataByChunk(data: any[]) {
  const chunkLen = 80;
  // 分块发送数据给服务器
  try {
    await Promise.all(
      new Array(Math.ceil(data?.length / chunkLen)).fill(0).map((_, i) => {
        return postServerGraph(data.slice(i * chunkLen, (i + 1) * chunkLen));
      }),
    );
  } catch (error) {
    console.log("数据发送失败:", error);
  }
}
// 发送数据逻辑
export function postServerGraph(data: any[]) {
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
