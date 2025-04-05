import cac from "cac";
import ora from "ora";
import { blue, green, yellow, red } from "chalk";
import {
  generateGraph,
  DEP_SPY_START,
  DEP_SPY_INJECT_MODE,
  DEP_SPY_COMMIT_HASH,
} from "@dep-spy/core";
import { conformConfig } from "./conformConfig";
import { createServer } from "./server/createServer";
import {
  createServer as createStaticServer,
  outPutPath,
  outPutUrl,
} from "./static/createServer";
import { exec, spawn } from "child_process";
import { addLogFile } from "./utils";
const cli = cac();
// 包依赖
cli
  .command("[analysis,ana]", "解析项目三方包依赖")
  .option("--graph <graph>", "输出依赖图的文件路径", {
    type: ["string"],
  })
  .option("--co,--codependency <codependency>", "输出相同依赖的文件路径", {
    type: ["string"],
  })
  .option(
    "--cir,--circularDependency <circularDependency>",
    "输出循环依赖的文件路径",
    {
      type: ["string"],
    },
  )
  .action(async (_, options) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Confirm, Input } = require("enquirer");

    options.depth = [
      Number(
        await new Input({
          name: "depth",
          message: "请输入依赖图最大深度",
          initial: 3,
        }).run(),
      ),
    ];
    // 判断 depth 是否为正整数
    if (!Number.isInteger(options.depth[0]) || options.depth[0] < 0) {
      throw new Error("depth 必须为正整数");
    }

    options.isOutput = [
      await new Confirm({
        name: "json",
        message: "是否输出依赖树的文件?",
        initial: false,
      }).run(),
    ];

    options = await conformConfig(options);

    const startTime = Date.now();
    const graph = generateGraph("", options);

    const spinner = ora(blue("🕵️ 正在潜入\n")).start();
    //构建树
    await graph.ensureGraph();

    //是否输出依赖树文件
    if (options.isOutput) {
      await graph.outputToFile();
    }
    spinner.stop();
    console.log(green(`破解完成,耗时 ${yellow(Date.now() - startTime)} ms`));

    // 启动可视化界面
    createServer(graph, options);
  });

// 源码依赖
cli
  .command("static [command]", "解析项目源码依赖")
  .option("--command <command>", "项目的构建命令", {
    type: ["string"],
  })
  .option("--inject", "是否将数据注入html", {
    type: ["boolean"],
  })
  .option("--commitHash <commitHash>", "与当前版本对比的commit hash", {
    type: ["string"],
  })
  .action(async (command, options) => {
    // 获取最终的配置文件
    options = await conformConfig(options);
    // 命令行参数优先级高于配置文件
    if (command) {
      options.command = command;
    }
    // 关键参数检测
    if (!options.command) {
      throw new Error(
        red("缺少项目的构建命令,请通过命令行参数或者配置文件添加"),
      );
    }
    const startTime = Date.now();
    const spinner = ora(blue("🕵️ 正在潜入\n")).start();

    // 设置环境变量，保证插件只能通过ds命令运行
    process.env[DEP_SPY_START] = "true";
    // 通过设置环境变量，传递用户配置
    if (options.inject) {
      process.env[DEP_SPY_INJECT_MODE] = "true";
    }
    if (options.commitHash) {
      process.env[DEP_SPY_COMMIT_HASH] = options.commitHash;
    }
    // 启动服务器，准备接收插件数据
    createStaticServer();
    exec(options.command, { cwd: process.cwd() }, (error, std) => {
      // 命令执行错误
      if (error) {
        console.log(red("构建命令执行错误"));
        console.error(error);
      }
      // 写入命令执行的输出作为日志
      spinner.stop();
      console.log(green(`破解完成,耗时 ${yellow(Date.now() - startTime)} ms`));
      // 注入模式不需要开发服务器，直接退出
      if (options.inject) {
        outPutPath();
        process.exit(0);
      }
      // vite插件运行完毕，数据已经发送完毕，可以展示web页面
      outPutUrl();
      // 添加日志信息
      addLogFile(std);
    });
    // 带参数模式
    // spawnCommand(options, startTime);
  });

cli.help();
cli.parse();

function spawnCommand(options: any, startTime: number) {
  // 分割命令和参数
  const [cmd, ...args] = options.command.split(/\s+/);

  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    stdio: "pipe",
    shell: true,
  });

  let stdOutput = "";
  let stdError = "";

  // 实时输出 stdout
  child.stdout.on("data", (data) => {
    const output = data.toString();
    stdOutput += output;
    process.stdout.write(output); // 实时打印输出
  });

  // 实时输出 stderr
  child.stderr.on("data", (data) => {
    const error = data.toString();
    stdError += error;
    process.stderr.write(error); // 实时打印错误
  });

  child.on("close", (code) => {
    // spinner.stop();

    if (code !== 0) {
      console.log(red("构建命令执行错误"));
      console.error(stdError);
      return;
    }

    console.log(green(`破解完成,耗时 ${yellow(Date.now() - startTime)} ms`));

    // 注入模式不需要开发服务器，直接退出
    if (options.inject) {
      outPutPath();
      process.exit(0);
    }

    // vite插件运行完毕，数据已经发送完毕，可以展示web页面
    outPutUrl();

    // 添加日志信息（合并 stdout 和 stderr）
    addLogFile(stdOutput + stdError);
  });

  child.on("error", (error) => {
    // spinner.stop();
    console.log(red("构建命令执行错误"));
    console.error(error);
  });
}
