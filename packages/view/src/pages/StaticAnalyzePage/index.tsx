import GridBackground from "@/components/GridBack";
import { GithubIcon, LanguageIcon, ThemeIcon } from "@/components/icon";
import Skeleton from "@/components/Skeleton";
import StaticTree from "@/components/StaticTree";
import { useStaticStore } from "@/contexts";
import moduleTree from "../../../moduleTree.json";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";

export default function StaticAnalyzePage() {
  const { staticRootLoading, staticRoot, setStaticRoot } = useStaticStore();
  async function init() {
    const tree = moduleTree;

    setStaticRoot(tree);
  }
  useEffect(() => {
    init();
  }, []);
  if (staticRootLoading && !staticRoot) {
    return <Skeleton></Skeleton>;
  }
  return (
    <main className="w-screen h-screen overflow-hidden">
      <div className="fixed">
        <StaticTree />
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
