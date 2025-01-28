import { useRef } from "react"



export const Sidebar = () => {
    const containerRef = useRef(null)
    const draggleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault()
        // 记录鼠标初始位置和元素初始宽度
        const startX = e.clientX
        const startWidth = containerRef.current.offsetWidth
        const mouseMove = (ev) => {
            // 计算鼠标移动的距离
            const dx = startX  -  ev.clientX
            
            // 设置元素的新宽度
            if(startWidth + dx < 20 || startWidth + dx > 300) containerRef.current.style.width = `${startWidth + dx}px`
        }
        const mouseUp = (ev) => {
            // 销毁监听函数
            window.removeEventListener('mousemove' , mouseMove)
            window.removeEventListener('mouseup' , mouseUp)
        }
        window.addEventListener('mousemove' , mouseMove)
        window.addEventListener('mouseup' , mouseUp)
    }

    return <div className="fixed h-[100%] flex right-0">
        <div onMouseDown={draggleMouseDown} className="w-[5px] h-[100%] cursor-col-resize absolute translate-x-[-50%]"></div>
        <div ref={containerRef} className="w-full h-[100%] text-[var(--color-text)]">11</div>
    </div>
}