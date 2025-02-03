import DropDown from "./DropDown";
import { useStaticStore } from "@/contexts";
import { useMemo } from "react";
import { shallow } from "zustand/shallow";
import { DropDownProps } from "./type";

const Tool = () => {
  const {
    // setStaticRoot,
    gitChangedNodes,
    importChangedNodes,
    setHighlightedNodeIds,
  } = useStaticStore(
    (state) => ({
      // setStaticRoot: state.setStaticRoot,
      gitChangedNodes: state.gitChangedNodes,
      importChangedNodes: state.importChangedNodes,
      setHighlightedNodeIds: state.setHighlightedNodeIds,
    }),
    shallow,
  );

  const fileOptions: DropDownProps = useMemo(
    () => ({
      title: "文件类型",
      options: [
        { label: "git变动文件", value: gitChangedNodes },
        { label: "导入变动的文件", value: importChangedNodes },
      ],
    }),
    [gitChangedNodes, importChangedNodes],
  );

  // 获取三种文件树--->构建treeOptions
  // {
  //  title: "树类型",
  //  options: [
  //   { label: "编译树", value: staticRoot1 },
  //   { label: "树2", value: staticRoot2 },
  //   { label: "树3", value: staticRoot3 },
  // ],
  // }

  return (
    <div className="w-80 h-20 -z-50 text-light flex  border-cyan justify-around">
      {/* <DropDown  /> */}
      <DropDown
        title={fileOptions.title}
        options={fileOptions.options}
        onSelect={(value) => {
          setHighlightedNodeIds(value);
        }}
      />
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
