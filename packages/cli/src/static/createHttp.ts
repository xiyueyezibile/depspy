import express, { Express } from "express";
import { bufferHandler, errorHandler } from "../utils";
import { jsonsToBuffer } from "@dep-spy/utils";
import { staticPath } from "@dep-spy/view";
import path from "path";
import { MODE } from "../constants";
import fs from "fs";

// inject模式下的根目录
const root = path.join(staticPath, MODE.INJECT);
/** 平铺树 buffer状态 */
const bufferArr:Buffer[] = [];

const entryIdAndExportToFileNames = new Map<string, string[]>();

export function createHttp(app: Express) {
  app.use(express.json());
  // 收集 bundle 图
  app.post<Buffer>("/collectBundle", (req, res) => {
    try {
      req.on("data", (chunk:Buffer) => {
        bufferArr.push(chunk);
      });
      req.on("end", () => {
        res.send({
          message: "success",
        });
        // 最后一个chunk再将数据注入到html
        if (req.query?.end) {
          // 设置数组到html
          injectData(JSON.stringify(parseNodeBuffer(Buffer.concat(bufferArr).buffer)));
        }

      })
    } catch (error) {
      errorHandler(res, error);
    }
  });
  // 收集文件导出变量影响文件列表
  app.post<Buffer>("/collectEntryIdAndExportToFileNames", (req, res) => {
    try {
      req.on("data", (chunk: Buffer) => {
        let offset = 0;
        const arrayBuffer = chunk.buffer;
        while (offset < arrayBuffer.byteLength) {
          const sizeView = new DataView(arrayBuffer, offset, 4);
          const nodeSize = sizeView.getInt32(0, true); // Little Endian

          offset += 4;

          const nodeBuffer = new Uint8Array(arrayBuffer, offset, nodeSize);
          offset += nodeSize;
          const nodeJson = new TextDecoder().decode(nodeBuffer);
          const node: {
            [key: string]: string[];
          } = JSON.parse(nodeJson);
          Object.keys(node).forEach((key) => {
            entryIdAndExportToFileNames.set(key, node[key]);
          });
        }
      });
      res.send({
        message: "success",
      });
    } catch (error) {
      errorHandler(res, error);
    }
  });
  // 获取静态树
  app.get("/getStaticTree", (_, res) => {
    try {
      bufferHandler(res, Buffer.concat(bufferArr));
    } catch (error) {
      errorHandler(res, error);
    }
  });
  // 获取文件变更的影响文件列表
  app.post<{
    path: string;
    exports: string[];
  }>("/getEffectedFiles", (req, res) => {
    const path = req.body.path;
    const exports: string[] = JSON.parse(req.body.exports);
    const effectedLists = new Set<string>();
    exports.forEach((exportName) => {
      const key = `${path}&${exportName}`;
      if (entryIdAndExportToFileNames.has(key)) {
        entryIdAndExportToFileNames.get(key).forEach((fileName) => {
          effectedLists.add(fileName);
        });
      }
    });
    bufferHandler(
      res,
      jsonsToBuffer([JSON.stringify(Array.from(effectedLists))]),
    );
  });
}

function injectData(data: string) {
  const indexPath = path.join(root, "index.html");
  const htmlString = fs.readFileSync(indexPath, "utf-8");
  const injectString = `<script>window.__depSpyStaticTreeLeaves__=${data}</script>`;
  const newHtmlString = htmlString.replace('<head>', `<head>${injectString}`);
  fs.writeFileSync(indexPath, newHtmlString);
}
export function parseNodeBuffer(buffer) {
  if (!buffer) {
    throw new Error("buffer is empty");
  }
  const nodes = [];
  let offset = 0;

  while (offset < buffer.byteLength) {
    // 读取数据块的大小（前4个字节）
    const sizeView = new DataView(buffer, offset, 4);
    const nodeSize = sizeView.getInt32(0, true); // Little Endian
    offset += 4;

    // 读取实际的数据
    const nodeBuffer = new Uint8Array(buffer, offset, nodeSize);
    offset += nodeSize;

    // 将数据转换为字符串并解析为对象
    const nodeJson = new TextDecoder().decode(nodeBuffer);
    const node = JSON.parse(nodeJson, (key, value) => {
      if (key === "childrenNumber" && (value === "Infinity" || value === null))
        return Infinity;
      return value;
    });
    nodes.push(node);
  }

  return nodes;
}