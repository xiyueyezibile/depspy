import { StaticNode } from "~/types";

//通过完整的路径 rootPath + pathId + '-' + id 截取name
export const extractFileName = (path: string) => {
  // 匹配包含 index 的路径
  const indexRegex = /\/([^/]+)\/index\.([^/]+)(?:-\d+)?$/;
  // 匹配不包含 index 的路径
  const normalRegex = /\/([^/]+)(?:-\d+)?$/;

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
  return path;
};

export const traverseTree = (
  node: StaticNode,
  callback: (node: StaticNode) => void,
) => {
  callback(node);
  for (const child of Object.values(node.children)) {
    traverseTree(child, callback);
  }
};

export const buildTree = (nodes: StaticNode[]) => {
  const nodeMap = new Map();
  let root = null;
  // 用于记录需要延迟挂载的子节点信息
  const pendingChildren = new Map();

  nodes.forEach((node) => {
    // 处理节点的 id
    node.pathId && (node.id = node.pathId + "-" + node.id);
    const newNode = { ...node, children: [] };
    nodeMap.set(node.id, newNode);

    const parentId = node.parentId;
    if (parentId) {
      const parent = nodeMap.get(parentId);
      if (parent) {
        // 父节点已存在，直接挂载到父节点
        parent.children.push(newNode);
      } else {
        // 父节点不存在，记录需要延迟挂载的子节点
        if (!pendingChildren.has(parentId)) {
          pendingChildren.set(parentId, []);
        }
        pendingChildren.get(parentId).push(newNode);
      }
    } else {
      // 无 parentId，直接为根节点
      root = newNode;
    }
  });

  // 处理延迟挂载的子节点
  pendingChildren.forEach((children, parentId) => {
    const parent = nodeMap.get(parentId);
    if (parent) {
      parent.children.push(...children);
    }
  });

  return root;
};
