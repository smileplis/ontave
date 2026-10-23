/** Draw only nearby cells; the surrounding page remains quiet. */
export function initReactiveGrids() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  document.querySelectorAll<HTMLElement>("[data-reactive-grid]").forEach(surface => {
    const canvas = surface.querySelector<HTMLCanvasElement>(".reactive-canvas");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let width = 0, height = 0, ratio = 1, x = 0, y = 0, active = false, frame = 0, alpha = 0;
    const resize = () => {
      const rect = surface.getBoundingClientRect();
      width = rect.width; height = rect.height; ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = () => {
      frame = 0;
      alpha += ((active && !reduced.matches ? 1 : 0) - alpha) * .16;
      ctx.clearRect(0, 0, width, height);
      const cell = 52, radius = 205;
      const minCol = Math.max(0, Math.floor((x-radius)/cell));
      const maxCol = Math.min(Math.ceil(width/cell),Math.ceil((x+radius)/cell));
      const minRow = Math.max(0,Math.floor((y-radius)/cell));
      const maxRow = Math.min(Math.ceil(height/cell),Math.ceil((y+radius)/cell));
      for(let col=minCol;col<maxCol;col++) for(let row=minRow;row<maxRow;row++) {
        const left=col*cell,top=row*cell;
        const distance=Math.hypot(left+cell/2-x,top+cell/2-y);
        const strength=Math.max(0,1-distance/radius)*alpha;
        if(strength < .01) continue;
        ctx.fillStyle=`rgba(85,117,91,${strength*.055})`;
        ctx.strokeStyle=`rgba(80,112,89,${strength*.24})`;
        ctx.lineWidth=.7;
        ctx.fillRect(left+1,top+1,cell-2,cell-2);
        ctx.strokeRect(left+.5,top+.5,cell,cell);
        if(strength > .65) {
          ctx.fillStyle=`rgba(80,112,89,${strength*.6})`;
          ctx.fillRect(left-1,top-1,3,3);
        }
      }
      if(Math.abs((active && !reduced.matches ? 1 : 0)-alpha) > .005) frame=requestAnimationFrame(draw);
    };
    surface.addEventListener("pointermove", event => {
      if(event.pointerType === "touch" || reduced.matches) return;
      const rect=surface.getBoundingClientRect(); x=event.clientX-rect.left; y=event.clientY-rect.top; active=true;
      surface.dataset.gridActive="true";
      if(!frame) frame=requestAnimationFrame(draw);
    },{passive:true});
    surface.addEventListener("pointerleave",()=>{ active=false; surface.dataset.gridActive="false"; if(!frame) frame=requestAnimationFrame(draw); });
    new ResizeObserver(resize).observe(surface);
    resize();
  });
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>entry.target.classList.toggle("in-view",entry.isIntersecting)),{threshold:.1});
  document.querySelectorAll(".overview,.benchmarks").forEach(el=>observer.observe(el));
}
