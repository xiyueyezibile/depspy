import SidebarButton from "../components/SidebarButton";
import { useStaticStore } from "@/contexts";
import { useEffect, useMemo, useState, useCallback } from "react";
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

  const [gitMap, setGitMap] = useState<Map<string, Set<string>>>(new Map());
  const [importMap, setImportMap] = useState<Map<string, Set<string>>>(
    new Map(),
  );

  useEffect(() => {
    if (!gitChangedNodes.size) return;
    const newMap = new Map<string, Set<string>>();
    gitChangedNodes.forEach((item) => {
      const fileName = extractFileName(item);
      // const parts = fileName.split("-");
      //找到最后一个‘-’
      const lastLineIndex = fileName.lastIndexOf("-");
      const pathId = fileName.slice(0, lastLineIndex);

      if (!newMap.has(pathId)) {
        newMap.set(pathId, new Set([item]));
      } else {
        newMap.get(pathId)?.add(item);
      }
    });
    setGitMap(newMap);
  }, [gitChangedNodes]);

  useEffect(() => {
    if (!importChangedNodes.size) return;
    const newMap = new Map<string, Set<string>>();
    importChangedNodes.forEach((item) => {
      const fileName = extractFileName(item);
      //找到最后一个‘-’
      const lastLineIndex = fileName.lastIndexOf("-");
      const pathId = fileName.slice(0, lastLineIndex);

      if (!newMap.has(pathId)) {
        newMap.set(pathId, new Set([item]));
      } else {
        newMap.get(pathId)?.add(item);
      }
    });
    setImportMap(newMap);
  }, [importChangedNodes]);

  const gitFileList = useMemo(() => {
    return Array.from(gitMap.keys()).map((item) => (
      <div
        key={item}
        className="p-2 hover:bg-gray-100 rounded hover:text-blue-500 min-w-80 cursor-pointer"
        data-path={item}
      >
        📄 {item}
      </div>
    ));
  }, [gitMap]);

  const importFileList = useMemo(() => {
    return Array.from(importMap.keys()).map((item) => (
      <div
        key={item}
        className="p-2 hover:bg-gray-100 rounded hover:text-blue-500 min-w-80 cursor-pointer"
        data-path={item}
      >
        ⚡ {item}
      </div>
    ));
  }, [importMap]);

  const totalCount = useMemo(() => {
    return activeTab === "git" ? gitChangedNodes.size : importChangedNodes.size;
  }, [activeTab, gitMap.size, importMap.size]);

  const handleFileListClick = useCallback(
    (e) => {
      const path = e.target.dataset.path || "";
      if (!path) return;
      if (activeTab === "git") {
        setHighlightedNodeIds(new Set(gitMap.get(path)));
      } else if (activeTab === "import") {
        setHighlightedNodeIds(new Set(importMap.get(path)));
      }
    },
    [gitMap, importMap, activeTab, setHighlightedNodeIds],
  );

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

      <div className="flex-1 overflow-auto p-4" onClick={handleFileListClick}>
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
