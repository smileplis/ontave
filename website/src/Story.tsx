import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
const chapters = [
  { label: "Capture", description: "Preserve the source before interpreting it." },
  { label: "Propose", description: "Propose a concept the current model cannot represent." },
  { label: "Evaluate", description: "Check the addition against evidence and existing contracts." },
  { label: "Review", description: "Approve the model. Accept the facts separately." },
  { label: "Query", description: "Query accepted records, without another model call." },
];
export function Story() {
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);
  const [chapter, setChapter] = useState(0);
  const [manual, setManual] = useState(true);
  useEffect(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference) and (min-width: 960px) and (min-height: 640px)", () => {
      setManual(false);
      return () => setManual(true);
    });
    return () => media.revert();
  }, []);
  useEffect(() => {
    if (manual) return;
    // Measure after React has committed the tall scroll layout.
    const scroll = ScrollTrigger.create({
      trigger: root.current,
      start: "top top",
      end: "bottom bottom",
      onUpdate: self => {
        setChapter(Math.min(4, Math.floor(self.progress * 5)));
        root.current?.style.setProperty("--story-progress", String(self.progress));
      },
    });
    trigger.current = scroll;
    ScrollTrigger.refresh();
    return () => { scroll.kill(); trigger.current = null; };
  }, [manual]);
  function navigate(index: number) {
    setChapter(index);
    const scroll = trigger.current;
    if (!manual && scroll) gsap.to(window, { scrollTo: scroll.start + (scroll.end - scroll.start) * ((index + .45) / 5), duration: .7, ease: "power2.inOut", overwrite: true });
  }
  return <section ref={root} id="walkthrough" className={`evolution-story ${manual ? "story-manual" : "story-scroll"}`} data-phase={chapter} aria-label="How Ontave works">
    <div className="evolution-sticky" data-reactive-grid>
      <canvas className="reactive-canvas" aria-hidden="true" />
      <div className="evolution-heading"><div><h2>How Ontave works.</h2></div><div className="evolution-narrative" aria-live={manual ? "polite" : "off"}><p>{chapters[chapter].description}</p></div></div>
      <div className="evolution-scene">
        <div className="scene-source"><blockquote>“Before installation,<br /><mark>inspect the roof.</mark>”</blockquote><div className="scene-flow" aria-hidden="true"><span /><i>→</i></div></div>
        <div className="scene-model"><svg className="ontology-graph" viewBox="0 0 500 330" role="img" aria-label={`An inspection concept ${chapter < 1 ? "has no place yet" : chapter < 3 ? "is proposed for review" : "has been approved"} alongside Person and Installation.`}>
          <defs><radialGradient id="node-wash"><stop stopColor="#9eb7b1" stopOpacity=".14"/><stop offset="1" stopColor="#9eb7b1" stopOpacity="0"/></radialGradient></defs>
          <circle className="graph-halo" cx="260" cy="170" r="160" fill="url(#node-wash)"/>
          <path className="graph-edge existing-edge" d="M115 78H365"/><circle className="graph-endpoint" cx="115" cy="78" r="3"/><circle className="graph-endpoint" cx="365" cy="78" r="3"/>
          <g className="existing-node"><rect x="15" y="42" width="145" height="70" rx="35"/><circle cx="42" cy="77" r="7"/><text x="65" y="84">Person</text></g>
          <g className="existing-node"><rect x="302" y="42" width="178" height="70" rx="35"/><rect x="326" y="70" width="14" height="14" rx="2"/><text x="352" y="84">Installation</text></g>
          <path className="graph-edge new-edge" d="M254 228C254 155 392 174 392 114"/><text className="relation-label" x="318" y="170">precedes</text>
          <g className="unknown-concept"><circle cx="255" cy="255" r="36"/><text x="255" y="264" textAnchor="middle">?</text></g>
          <g className="proposed-node"><rect x="113" y="220" width="284" height="74" rx="37"/><path d="m141 258 9-9 9 9-9 9Z"/><text x="175" y="265">RoofInspection</text></g>
          <g className="evaluation-orbit"><circle cx="255" cy="257" r="112"/><circle cx="367" cy="257" r="4"/></g>
        </svg></div>
        <div className="scene-record"><div className="scene-flow" aria-hidden="true"><span /><i>→</i></div><div className="record-reveal" aria-hidden={chapter < 4}><div className="record-type">RoofInspection</div><p>“inspect the roof”</p><small>reported · source linked</small></div></div>
      </div>
      <div className="evolution-bottom"><nav className="evolution-chapters" aria-label="Walkthrough chapters">{chapters.map((item,index)=><button key={item.label} type="button" aria-pressed={chapter === index} onClick={()=>navigate(index)} onKeyDown={e=>{if(e.key === "ArrowRight" || e.key === "ArrowLeft"){e.preventDefault(); const next=(index+(e.key === "ArrowRight" ? 1 : 4))%5; navigate(next); (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();}}}>{item.label}<i aria-hidden="true"/></button>)}</nav><div className="evolution-bottom-links"><a href="/playground/">Explore the SDK example <span aria-hidden="true">↗</span></a></div></div>
    </div>
  </section>;
}
