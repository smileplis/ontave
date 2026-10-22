import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
const chapters = [
  { label: "Capture", title: "Start with what happened.", description: "The message stays intact. Every interpretation has somewhere to point back to." },
  { label: "Propose", title: "Make room for something new.", description: "An inspection doesn’t fit the existing model. Ontave proposes a concept and its relationship." },
  { label: "Evaluate", title: "Check the change before it lands.", description: "Evaluate the proposed addition against its evidence and the existing application contract." },
  { label: "Review", title: "Keep the decision in your hands.", description: "Approve the model change. Review and accept the proposed facts separately." },
  { label: "Use", title: "Give your application something useful.", description: "Read an accepted, source-linked record through a typed contract. No inference on read." },
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
      <div className="evolution-heading"><div><span className="section-kicker">HOW ONTAVE WORKS</span><h2>How Ontave works.</h2></div><div className="evolution-narrative" aria-live={manual ? "polite" : "off"}><span className="stage-count">0{chapter + 1} / 05</span><h3>{chapters[chapter].title}</h3><p>{chapters[chapter].description}</p></div></div>
      <div className="evolution-scene">
        <div className="scene-source"><span className="scene-label">A MESSAGE</span><blockquote>“Before installation,<br /><mark>inspect the roof.</mark>”</blockquote><div className="source-trace"><span className="trace-dot" />Original evidence retained</div><div className="scene-flow" aria-hidden="true"><span /><i>→</i></div></div>
        <div className="scene-model"><span className="scene-label">{chapter === 0 ? "YOUR EXISTING MODEL" : chapter < 3 ? "A PROPOSED ADDITION" : "YOUR REVIEWED MODEL"}</span><svg className="ontology-graph" viewBox="0 0 500 330" role="img" aria-label={`An inspection concept ${chapter < 1 ? "has no place yet" : chapter < 3 ? "is proposed for review" : "has been approved"} alongside Person and Installation.`}>
          <defs><radialGradient id="node-wash"><stop stopColor="#9eb7b1" stopOpacity=".14"/><stop offset="1" stopColor="#9eb7b1" stopOpacity="0"/></radialGradient></defs>
          <circle className="graph-halo" cx="260" cy="170" r="160" fill="url(#node-wash)"/>
          <path className="graph-edge existing-edge" d="M115 78H365"/><circle className="graph-endpoint" cx="115" cy="78" r="3"/><circle className="graph-endpoint" cx="365" cy="78" r="3"/>
          <g className="existing-node"><rect x="15" y="42" width="145" height="70" rx="35"/><circle cx="42" cy="77" r="7"/><text x="65" y="84">Person</text></g>
          <g className="existing-node"><rect x="302" y="42" width="178" height="70" rx="35"/><rect x="326" y="70" width="14" height="14" rx="2"/><text x="352" y="84">Installation</text></g>
          <path className="graph-edge new-edge" d="M254 228C254 155 392 174 392 114"/><text className="relation-label" x="318" y="170">precedes</text>
          <g className="unknown-concept"><circle cx="255" cy="255" r="36"/><text x="255" y="264" textAnchor="middle">?</text><text className="unknown-caption" x="255" y="323" textAnchor="middle">An inspection is new.</text></g>
          <g className="proposed-node"><rect x="113" y="220" width="284" height="74" rx="37"/><path d="m141 258 9-9 9 9-9 9Z"/><text x="175" y="265">RoofInspection</text></g>
          <g className="evaluation-orbit"><circle cx="255" cy="257" r="112"/><circle cx="367" cy="257" r="4"/></g>
        </svg><div className="model-decision"><span className="decision-dot" />{chapter === 0 ? "A little room for what comes next" : chapter === 1 ? "Proposed · nothing applied" : chapter === 2 ? "The evaluation · checked before activation" : chapter === 3 ? "Model approved · facts reviewed separately" : "Model extended · evidence kept"}</div></div>
        <div className="scene-record"><div className="scene-flow" aria-hidden="true"><span /><i>→</i></div><span className="scene-label">{chapter < 4 ? "READY WHEN YOU ARE" : "AN ACCEPTED RECORD"}</span><div className="record-reveal" aria-hidden={chapter < 4}><div className="record-type"><span>◇</span> RoofInspection</div><dl><div><dt>requirement</dt><dd>inspect the roof</dd></div><div><dt>verification</dt><dd><span className="reported-state">reported</span></dd></div><div><dt>source</dt><dd className="source-linked">linked <span>↗</span></dd></div></dl><span className="typed-read-label">Typed reads. No model call.</span></div><div className="record-placeholder" aria-hidden="true"><span /><span /><span /><p>Your application’s next useful record.</p></div></div>
      </div>
      <div className="evolution-bottom"><nav className="evolution-chapters" aria-label="Walkthrough chapters">{chapters.map((item,index)=><button key={item.label} type="button" aria-pressed={chapter === index} onClick={()=>navigate(index)} onKeyDown={e=>{if(e.key === "ArrowRight" || e.key === "ArrowLeft"){e.preventDefault(); const next=(index+(e.key === "ArrowRight" ? 1 : 4))%5; navigate(next); (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();}}}><span>0{index+1}</span>{item.label}<i aria-hidden="true"/></button>)}</nav><div className="evolution-bottom-links"><span className="scroll-cue">{manual ? "Choose a step to explore" : "Scroll to follow the change"} <span aria-hidden="true">↓</span></span><a href="/playground/">Try the interactive example <span aria-hidden="true">↗</span></a></div></div>
      <span className="story-example-label">Illustrative example</span>
    </div>
  </section>;
}
