import { useStaticStore } from "@/contexts";
import { traverseTree } from "../../utils";
import { shallow } from "zustand/shallow";
import { useEffect, useState, useMemo } from "react";
import useLanguage from "@/i18n/hooks/useLanguage";
import { useStore } from "@/contexts";

export const Selected = () => {
  const { staticRoot, highlightedNodeIds } = useStaticStore(
    (state) => ({
      staticRoot: state.staticRoot,
      highlightedNodeIds: state.highlightedNodeIds,
    }),
    shallow,
  );
  const { language } = useStore(
    (state) => ({
      language: state.language,
    }),
    shallow,
  );
  const { t } = useLanguage();

  //用于渲染节点信息列表
  const [selectNodeInfo, setSelectNodeInfo] = useState<SelectNodeInfo[]>([]);

  useEffect(() => {
    if (!staticRoot || !highlightedNodeIds) return;
    const rootPath = staticRoot.rootId;
    const cloneSet = Array.from(highlightedNodeIds).map((id) => {
      return id.replace(rootPath, "");
    });
    const res: SelectNodeInfo[] = [];
    traverseTree(staticRoot, (node) => {
      if (cloneSet.includes(node.id)) {
        res.push({
          name: node.name,
          removedExports: node.removedExports,
          renderedExports: node.renderedExports,
        });
      }
    });
    setSelectNodeInfo(res);
  }, [highlightedNodeIds, staticRoot]);

  const SelectNodeCardList = useMemo(() => {
    return selectNodeInfo.map((item) => {
      return (
        <div className="w-full p-4 rounded-lg shadow-md mb-4">
          <h2 className="text-[var(--color-primary-text)] text-xl font-bold mb-2">
            {item.name}
          </h2>
          <div className="mb-2">
            <p className="text-[var(--color-text)] font-semibold">
              {/* Removed Exports: */}
              {t("static.sidebar.select.export.remove")}
            </p>
            {item.removedExports.length && (
              <ul className="list-disc list-inside text-[var(--color-text-description)]">
                {item.removedExports.map((exportItem, index) => (
                  <li key={index}>{exportItem}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[var(--color-text)] font-semibold">
              {/* Rendered Exports: */}
              {t("static.sidebar.select.export.render")}
            </p>
            {item.renderedExports.length && (
              <ul className="list-disc list-inside text-[var(--color-text-description)]">
                {item.renderedExports.map((exportItem, index) => (
                  <li key={index}>{exportItem}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      );
    });
  }, [selectNodeInfo, language]);

  return (
    <>
      <div className="bg-bg-layout min-w-90">{SelectNodeCardList}</div>
    </>
  );
};

interface SelectNodeInfo {
  name: string;
  removedExports: string[];
  renderedExports: string[];
}
