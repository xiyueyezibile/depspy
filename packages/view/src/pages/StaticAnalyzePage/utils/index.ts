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

export const buildTree = (nodes) => {
  const cloneNodes = JSON.parse(JSON.stringify(nodes));
  const nodeMap = new Map();
  let root = null;
  cloneNodes.forEach((node) => {
    node.pathId && (node.id = node.pathId + "-" + node.id);
  });
  cloneNodes.forEach((node) => {
    nodeMap.set(node.id, { ...node, children: [] });
  });
  cloneNodes.forEach((node) => {
    const parentId = node.parentId;
    if (parentId) {
      const parent = nodeMap.get(parentId);
      if (parent) {
        parent.children.push(nodeMap.get(node.id)); // 挂载到父节点
      } else {
        root = nodeMap.get(node.id); // 父节点不存在，作为根节点
      }
    } else {
      root = nodeMap.get(node.id); // 无 parentId，直接为根节点
    }
  });
  traverseTree(root, (node) => {
    if (node.id.includes("-")) {
      const [pathId, id] = splitPath(node.id);
      if (pathId) {
        node.pathId = pathId;
        node.id = id;
      }
    }
  });
  return root;
};

function splitPath(path: string) {
  const lastLineIndex = path.lastIndexOf("-");
  const pathId = path.slice(0, lastLineIndex);
  const id = path.slice(lastLineIndex + 1);
  return [pathId, id];
}
