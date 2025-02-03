import express, { Express } from "express";
import { bufferHandler, errorHandler } from "../utils";

const bufferArr = [];

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
  // 获取静态树
  app.get("/getStaticTree", (_, res) => {
    try {
      bufferHandler(res, Buffer.concat(bufferArr));
    } catch (error) {
      errorHandler(res, error);
    }
  });
}
