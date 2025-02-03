//通过完整的路径 rootPath + pathId + '-' + id 截取name
export const extractFileName = (path) => {
  // 匹配包含 index 的路径
  const indexRegex = /\/([^/]+)\/index\.([^/]+-\d+)$/;
  // 匹配不包含 index 的路径
  const normalRegex = /\/([^/]+-\d+)$/;

  if (path.includes("/index.")) {
    const match = path.match(indexRegex);
    if (match) {
      return `${match[1]}/index.${match[2]}`;
    }
  }
  const match = path.match(normalRegex);
  if (match) {
    return match[1];
  }
  return null;
};

export const traverseTree = (node, callback) => {
  callback(node);
  for (const child of Object.values(node.children)) {
    traverseTree(child, callback);
  }
};