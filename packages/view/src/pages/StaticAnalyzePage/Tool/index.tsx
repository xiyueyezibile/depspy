import MyButton from "./MyButton";
import { useStaticStore } from "@/contexts";
import { useState, useEffect } from "react";
import { shallow } from "zustand/shallow";

const Tool = () => {
  const {
    staticRoot,
    // setStaticRoot,
    setHighlightedNodeIds,
  } = useStaticStore(
    (state) => ({
      staticRoot: state.staticRoot,
      // setStaticRoot: state.setStaticRoot,
      setHighlightedNodeIds: state.setHighlightedNodeIds,
    }),
    shallow,
  );

  const [gitChandeNodes, setGitChandeNodes] = useState<Set<string>>(new Set());
  const rootPath = staticRoot.rootId;

  useEffect(() => {
    if (!staticRoot) return;
    //获取git变动文件
    const gitChangeSet = new Set<string>();
    traverseTree(staticRoot, (node) => {
      if (node.isGitChange) {
        gitChangeSet.add(rootPath + node.pathId + "-" + node.id);
      }
    });
    setGitChandeNodes(gitChangeSet);
  }, [staticRoot]);

  const handleGitChangeClick = () => {
    setHighlightedNodeIds(gitChandeNodes);
    // setHighlightedNodeIds(
    //   new Set([
    //     "/Users/ziplili/Desktop/code/xiyueyezibile-depspy/packages/view/src/main.tsx-2",
    //   ]),
    // );
  };

  return (
    <div className="w-100 h-60 -z-50 text-light flex">
      <div className="w-50 h-full flex flex-col justify-around items-center">
        <MyButton>树1</MyButton>
        <MyButton>树2</MyButton>
        <MyButton>树3</MyButton>
      </div>
      <div className="w-50 h-full flex flex-col justify-around items-center">
        <MyButton onClick={handleGitChangeClick}>git变动文件</MyButton>
        <MyButton>被影响的文件</MyButton>
        <MyButton>普通文件</MyButton>
      </div>
    </div>
  );
};

const traverseTree = (node, callback) => {
  callback(node);
  for (const child of Object.values(node.children)) {
    traverseTree(child, callback);
  }
};

export default Tool;
