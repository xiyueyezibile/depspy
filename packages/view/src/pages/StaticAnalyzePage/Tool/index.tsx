// import DropDown from "./DropDown";
import { useStaticStore } from "@/contexts";
// import { useMemo } from "react";
import { shallow } from "zustand/shallow";
// import { DropDownProps } from "./type";
import ToggleButton from "./ToggleButton";

const Tool = () => {
  const {
    // setStaticRoot,
    setShowGitChangedNodes,
    setShowImportChangedNodes,
  } = useStaticStore(
    (state) => ({
      // setStaticRoot: state.setStaticRoot,
      setShowGitChangedNodes: state.setShowGitChangedNodes,
      setShowImportChangedNodes: state.setShowImportChangedNodes,
    }),
    shallow,
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
      <ToggleButton
        label="git变更文件"
        onChange={(e) => {
          setShowGitChangedNodes(e);
        }}
      />
      <ToggleButton
        label="import变更文件"
        onChange={(e) => {
          setShowImportChangedNodes(e);
        }}
      />
    </div>
  );
};

export default Tool;
