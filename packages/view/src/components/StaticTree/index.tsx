import { useEffect, useRef, useState, useCallback } from "react";
import * as G6 from "@antv/g6";
import { useStaticStore } from "@/contexts";
import { textOverflow } from "../../utils/textOverflow";

export default function StaticTree() {
  const {
    staticRoot,
    // setStaticRoot,
    setHighlightedNodeIds,
    highlightedNodeIds,
  } = useStaticStore((state) => ({
    staticRoot: state.staticRoot,
    setStaticRoot: state.setStaticRoot,
    highlightedNodeIds: state.highlightedNodeIds,
    setHighlightedNodeIds: state.setHighlightedNodeIds,
  }));
  const graphRef = useRef<G6.TreeGraph>();
  const [cloneData, setCloneData] = useState();
  const [circleMap, setCircleMap] = useState(new Map());
  const highlightedNodeIdsRef = useRef(highlightedNodeIds);
  const containerRef = useRef<HTMLDivElement>();
  const rootPath = staticRoot.rootId;

  // console.log(staticRoot);

  const expandNode = useCallback(
    (item: G6.Node, flag: boolean) => {
      if (!graphRef.current) return;
      const model = item.getModel();
      if (!model.collapsed) return;
      const matrix = graphRef.current.getGroup().getMatrix();

      const zoom = graphRef.current.getZoom();
      const offsetX = matrix[6] / zoom;
      const offsetY = matrix[7] / zoom;

      graphRef.current.updateItem(item, {
        collapsed: !flag,
      });
      graphRef.current.changeData(cloneData);
      circleMap.forEach((k, v) => {
        if (graphRef.current.findById(v) && graphRef.current.findById(k)) {
          graphRef.current.addItem("edge", {
            source: k,
            target: v,
            type: "circle-line",
          });
        }
      });
      //保持在展开折叠后树节点位置不变
      graphRef.current.translate(offsetX, offsetY);
      graphRef.current.zoom(zoom);
      graphRef.current.refresh();
    },
    [graphRef, cloneData, circleMap],
  );

  useEffect(() => {
    //清除所有item的高亮状态
    highlightedNodeIdsRef.current = highlightedNodeIds;
    if (!highlightedNodeIds || !graphRef.current) return;
    const nodes = graphRef.current.getNodes();
    const edges = graphRef.current.getEdges();
    nodes.forEach((node) => {
      graphRef.current.setItemState(node, "highlight", false);
      graphRef.current.refreshItem(node);
    });
    edges.forEach((edge) => {
      graphRef.current.setItemState(edge, "highlight", false);
      graphRef.current.refreshItem(edge);
    });

    //为当前item添加高亮状态
    highlightedNodeIds.forEach((id) => {
      // 先尝试展开节点
      const rawItem = graphRef.current.findById(id) as G6.Node;
      if (rawItem) expandNode(rawItem, true);

      const item = graphRef.current.findById(id) as G6.Node;
      if (!item) return;
      const relatedEdges = item?.getEdges() || [];
      graphRef.current.setItemState(item, "highlight", true);
      graphRef.current.refreshItem(item);
      relatedEdges.forEach((edge) => {
        const {
          _cfg: { currentShape },
        } = edge;
        if (currentShape === "custom-polyline") {
          graphRef.current.setItemState(edge, "highlight", true);
          graphRef.current.refreshItem(edge);
        } else {
          //判断当前节点是否是起点
          if (edge.getSource().getModel().id === item.getModel().id) {
            graphRef.current.setItemState(edge, "highlight", true);
            graphRef.current.refreshItem(edge);
          }
        }
      });
    });
    // graphRef.current.refresh();
  }, [highlightedNodeIds]);

  useEffect(() => {
    const newData = deepClone(staticRoot);
    const map = new Map();
    //转换为g6的数据格式
    G6.Util.traverseTree(newData, (subTree) => {
      if (new Set(subTree.path).size !== subTree.path.length) {
        for (let i = 0; i < subTree.idpath.length; i++) {
          if (subTree.path[i] === subTree.pathId) {
            const id = rootPath + subTree.path[i] + "-" + subTree.idpath[i];

            map.set(id, rootPath + subTree.pathId + "-" + subTree.id);
          }
        }
      }
      subTree.id = rootPath + subTree.pathId + "-" + subTree.id;
      //初始化折叠状态
      subTree.collapsed = false;
      return true;
    });
    setCloneData(newData);
    setCircleMap(map);
  }, [staticRoot]);

  useEffect(() => {
    if (!cloneData || !containerRef.current) return;
    // hover
    const tooltip = new G6.Tooltip({
      offsetX: 10,
      offsetY: 20,
      getContent(e) {
        const model = e.item._cfg.model;
        const outDiv = document.createElement("div");
        outDiv.style.width = "fit-content";
        outDiv.innerHTML = model.name as string;
        return outDiv;
      },
      itemTypes: ["node"],
    });

    //注册自定节点和边
    G6RegisterNode();

    const width = containerRef.current.scrollWidth;
    const height = containerRef.current.scrollHeight || 500;
    const graph = new G6.TreeGraph({
      container: "container",
      width,
      height,
      // fitView: true,
      modes: {
        default: [
          {
            type: "collapse-expand",
            onChange: function onChange(item, collapsed) {
              const data = item.get("model");
              graph.updateItem(item, {
                collapsed,
              });
              data.collapsed = collapsed;
              return true;
            },
            shouldBegin(e) {
              // 若当前操作的节点 id 为 'node1'，则不发生 collapse-expand
              if (e.target && e.target.cfg.name === "collapse-icon")
                return true;

              return false;
            },
          },
          "drag-canvas",
          "zoom-canvas",
        ],
      },
      nodeStateStyles: {
        highlight: {
          stroke: "yellow",
          lineWidth: 2,
        },
      },
      edgeStateStyles: {
        highlight: {
          stroke: "yellow",
        },
      },
      defaultNode: {
        type: "tree-node",
        anchorPoints: [
          [0, 0.5],
          [1, 0.5],
        ],
      },
      defaultEdge: {
        type: "custom-polyline",
      },
      layout: {
        type: "compactBox",
        direction: "LR",
        getId: function getId(d) {
          return rootPath + d.pathId + "-" + d.id;
        },
        getVGap: function getVGap() {
          return 0;
        },
        getHGap: function getHGap() {
          return 80;
        },
      },
      fitViewPadding: [50, 450, 50, 50],
      plugins: [tooltip],
    });

    graphRef.current = graph;

    // initData(staticRoot);

    graph.data(cloneData);
    graph.render();
    circleMap.forEach((k, v) => {
      if (graph.findById(v) && graph.findById(k)) {
        graph.addItem("edge", {
          source: k,
          target: v,
          type: "circle-line",
        });
      }
    });
    // graph.fitView();
    //居中
    graph.translate(graph.getWidth() / 2, graph.getHeight() / 2);

    //注册事件 --> 折叠与展开 高亮节点
    graph.on("node:click", (e) => {
      if (e.target.cfg.name === "collapse-icon") {
        clearHighlight();
        const item = e.item;
        if (!item) return;
        const model = item.getModel();
        const matrix = graph.getGroup().getMatrix();

        const zoom = graph.getZoom();
        const offsetX = matrix[6] / zoom;
        const offsetY = matrix[7] / zoom;

        graph.updateItem(item, {
          collapsed: !model.collapsed,
        });
        graph.changeData(cloneData);
        circleMap.forEach((k, v) => {
          if (graph.findById(v) && graph.findById(k)) {
            graph.addItem("edge", {
              source: k,
              target: v,
              type: "circle-line",
            });
          }
        });
        //保持在展开折叠后树节点位置不变
        graph.translate(offsetX, offsetY);
        graph.zoom(zoom);
        graph.refresh();

        // graph.fitView();
      } else {
        e.stopPropagation();
        clearHighlight();
        const item = e.item;
        // const edges = item.getEdges();
        const set = new Set<string>();
        // item.setState("highlight", true);
        // graph.refreshItem(item);
        item._cfg.id && set.add(item._cfg.id);
        // edges.forEach((edge) => {
        //   set.add(edge._cfg.id);
        // });
        setHighlightedNodeIds(set);
      }
    });

    //点击画布取消高亮
    graph.on("canvas:click", () => {
      clearHighlight();
    });
    return () => {
      graph.destroy();
      graphRef.current = null;
    };
  }, [cloneData]);

  const clearHighlight = () => {
    setHighlightedNodeIds(new Set());
  };

  useEffect(() => {
    if (!window) return;
    window.onresize = throttle(() => {
      console.log("hahah");
      containerRef.current.style.width = `${document.documentElement.clientWidth}px`;
      containerRef.current.style.height = `${document.documentElement.clientHeight}px`;
      if (graphRef.current) {
        graphRef.current.changeSize(window.innerWidth, window.innerHeight);
        graphRef.current.fitView();
      }
    }, 100);
    return () => {
      window.onresize = null;
    };
  }, []);

  return (
    <div id="container" ref={containerRef} className="w-100vw h-100vh"></div>
  );
}

//深拷贝
const deepClone = (obj) => {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  const clone = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    if (Object.hasOwnProperty.call(obj, key)) {
      clone[key] = deepClone(obj[key]);
    }
  }
  return clone;
};

//节流
const throttle = (func, delay) => {
  let timer = null;
  return function () {
    if (!timer) {
      func.apply(this, arguments);
      timer = setTimeout(() => {
        timer = null;
      }, delay);
    }
  };
};

//注册自定节点和边
function G6RegisterNode() {
  // 注册module节点
  G6.registerNode(
    "tree-node",
    {
      drawShape: function drawShape(cfg, group) {
        const rect = group.addShape("rect", {
          attrs: {
            x: 0,
            y: 0,
            width: 100,
            height: 20,
            fill: "transparent", // 添加透明填充色确保点击区域覆盖整个矩形
            stroke: "rgb(167,167,167)",
            radius: 5,
          },
          // must be assigned in G6 3.3 and later versions. it can be any string you want, but should be unique in a custom item type
          name: "rect-shape",
        });
        const content = textOverflow(cfg.name, 100);
        const text = group.addShape("text", {
          attrs: {
            text: content,
            fill: "white",
          },
          // must be assigned in G6 3.3 and later versions. it can be any string you want, but should be unique in a custom item type
          name: "text-shape",
        });
        const tbox = text.getBBox();
        const rbox = rect.getBBox();
        const hasChildren =
          Array.isArray(cfg.children) && cfg.children.length > 0;
        text.attr({
          x: (rbox.width - tbox.width) / 2,
          y: (rbox.height + tbox.height) / 2,
        });
        if (hasChildren) {
          group.addShape("marker", {
            attrs: {
              x: rbox.width + 8,
              y: 0,
              r: 6,
              symbol: cfg.collapsed ? G6.Marker.expand : G6.Marker.collapse,
              stroke: "rgb(167,167,167)",
              lineWidth: 1,
            },
            // must be assigned in G6 3.3 and later versions. it can be any string you want, but should be unique in a custom item type
            name: "collapse-icon",
          });
        }
        return rect;
      },
      update: (cfg, item) => {
        const group = item.getContainer();
        const icon = group.find((e) => e.get("name") === "collapse-icon");
        icon?.attr(
          "symbol",
          cfg.collapsed ? G6.Marker.expand : G6.Marker.collapse,
        );
      },
    },
    "single-node",
  );
  // 注册线节点
  G6.registerEdge("custom-polyline", {
    draw(cfg, group) {
      const startPoint = cfg.startPoint;
      const endPoint = cfg.endPoint;

      let strokeColor = "rgb(167,167,167)";
      const edge = group.get("item");
      if (edge.hasState("highlight")) {
        strokeColor = "yellow";
      }
      const shape = group.addShape("path", {
        attrs: {
          stroke: strokeColor,
          path: [
            ["M", startPoint.x, startPoint.y],
            ["L", endPoint.x / 3 + (2 / 3) * startPoint.x, startPoint.y], // 三分之一处
            ["L", endPoint.x / 3 + (2 / 3) * startPoint.x, endPoint.y], // 三分之二处
            ["L", endPoint.x, endPoint.y],
          ],
          endArrow: true,
        },
        // 在 G6 3.3 及之后的版本中，必须指定 name，可以是任意字符串，但需要在同一个自定义元素类型中保持唯一性
        name: "custom-polyline-path",
      });
      return shape;
    },
  });
  // 注册循环线节点
  G6.registerEdge("circle-line", {
    draw(cfg, group) {
      const { startPoint, endPoint } = cfg;

      let strokeColor = "red";
      const edge = group.get("item");
      if (edge.hasState("highlight")) {
        strokeColor = "yellow";
      }
      const shape = group.addShape("line", {
        attrs: {
          x1: startPoint.x,
          y1: startPoint.y,
          x2: endPoint.x,
          y2: endPoint.y,
          stroke: strokeColor,
          lineWidth: 2, // 线宽
        },
        name: "circle-line-path",
      });
      return shape;
    },
  });
}
