import GridBackground from "@/components/GridBack";
import { GithubIcon, LanguageIcon, ThemeIcon } from "@/components/icon";
import Skeleton from "@/components/Skeleton";
import StaticTree from "@/components/StaticTree";
import { useStaticStore } from "@/contexts";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import Tool from "./Tool";
import { traverseTree, buildTree } from "./utils";
import { getStaticGraph } from "@/contexts/api";

export default function StaticAnalyzePage() {
  const {
    staticRootLoading,
    staticRoot,
    setStaticRoot,
    setGitChangedNodes,
    setImportChangedNodes,
  } = useStaticStore();

  async function init() {
    const moduletree = await getStaticGraph();
    const tree = buildTree(moduletree);
    setStaticRoot(tree);
  }
  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (!staticRoot) return;
    if (staticRoot) {
      //初始化git变更文件 导入变更文件
      const gitChangeSet = new Set<string>();
      const importChangeSet = new Set<string>();
      const rootPath = staticRoot.rootId;
      traverseTree(staticRoot, (node) => {
        if (node.isGitChange) {
          gitChangeSet.add(rootPath + node.pathId + "-" + node.id);
        }
        if (node.isImportChange) {
          importChangeSet.add(rootPath + node.pathId + "-" + node.id);
        }
      });
      setGitChangedNodes(gitChangeSet);
      setImportChangedNodes(importChangeSet);
    }
  }, [staticRoot]);

  if (staticRootLoading && !staticRoot) {
    return <Skeleton></Skeleton>;
  }
  return (
    <main className="w-screen h-screen overflow-hidden">
      <div className="fixed">
        <StaticTree />
      </div>
      <div className="fixed left-0 bottom-0">
        <Tool />
      </div>
      <div className="fixed -z-50 bg-bg-container">
        <GridBackground></GridBackground>
      </div>
      <Sidebar />
      <div className="fixed flex p-5">
        <LanguageIcon />
        <ThemeIcon />
        <GithubIcon />
      </div>
    </main>
  );
}
