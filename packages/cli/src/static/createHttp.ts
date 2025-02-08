import express, { Express } from "express";
import { bufferHandler, errorHandler } from "../utils";
import { jsonsToBuffer } from "@dep-spy/utils";
/** 平铺树 buffer状态 */
const bufferArr = [];

const entryIdAndExportToFileNames = new Map<string, string[]>();

export function createHttp(app: Express) {
  app.use(express.json());
  // 收集 bundle 图
  app.post<Buffer>("/collectBundle", (req, res) => {
    try {
      req.on("data", (chunk) => {
        bufferArr.push(chunk);
      });
      res.send({
        message: "success",
      });
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
