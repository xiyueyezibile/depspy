import SidebarButton from "../components/SidebarButton";
import { useStaticStore } from "@/contexts";
import { useMemo, useState } from "react";
import { shallow } from "zustand/shallow";
import { extractFileName } from "../../utils";

export const Global = () => {
  const [activeTab, setActiveTab] = useState<"git" | "import">("git");
  const { gitChangedNodes, importChangedNodes, setHighlightedNodeIds } =
    useStaticStore(
      (state) => ({
        gitChangedNodes: state.gitChangedNodes,
        importChangedNodes: state.importChangedNodes,
        setHighlightedNodeIds: state.setHighlightedNodeIds,
      }),
      shallow,
    );

  const gitFileList = useMemo(() => {
    return Array.from(gitChangedNodes).map((item) => (
      <div
        key={item}
        className="p-2 hover:bg-gray-100 rounded hover:text-blue-500 min-w-80 cursor-pointer"
        data-path={item}
      >
        📄 {extractFileName(item)}
      </div>
    ));
  }, [gitChangedNodes]);

  const importFileList = useMemo(() => {
    return Array.from(importChangedNodes).map((item) => (
      <div
        key={item}
        className="p-2 hover:bg-gray-100 rounded hover:text-blue-500 min-w-80 cursor-pointer"
        data-path={item}
      >
        ⚡ {extractFileName(item)}
      </div>
    ));
  }, [importChangedNodes]);

  const totalCount = useMemo(() => {
    return activeTab === "git" ? gitChangedNodes.size : importChangedNodes.size;
  }, [activeTab, gitChangedNodes.size, importChangedNodes.size]);

  return (
    <div className="h-full flex flex-col">
      <header className="flex gap-2 p-2 border-b">
        <SidebarButton onClick={() => setActiveTab("git")}>
          Git 变动文件
        </SidebarButton>

        <SidebarButton onClick={() => setActiveTab("import")}>
          导入变动文件
        </SidebarButton>
      </header>

      <div className="p-4 font-bold border-b min-w-40">
        当前数量：<span className="text-blue-500">{totalCount}</span>
      </div>

      <div
        className="flex-1 overflow-auto p-4"
        onClick={(e) => {
          const path = e.target.dataset.path;
          if (!path) return;
          setHighlightedNodeIds(new Set([path]));
        }}
      >
        {activeTab === "git" && (
          <div className="space-y-2">
            {gitFileList.length > 0 ? (
              gitFileList
            ) : (
              <div className="text-gray-400 p-4 text-center">
                暂无 Git 变动文件
              </div>
            )}
          </div>
        )}

        {activeTab === "import" && (
          <div className="space-y-2">
            {importFileList.length > 0 ? (
              importFileList
            ) : (
              <div className="text-gray-400 p-4 text-center">
                暂无受影响文件
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
