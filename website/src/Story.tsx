import React, { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
const chapters = [
  {
    name: "The message",
    title: "A familiar workflow.\nAn unfamiliar detail.",
    body: "Your application knows people and installations. The next message introduces something it cannot represent yet.",
  },
  {
    name: "The proposal",
    title: "Give the new idea\na place in the model.",
    body: "Ontave preserves the source and proposes RoofInspection. A proposal changes nothing until you decide.",
  },
  {
    name: "The evaluation",
    title: "A change worth making\nshould keep its promises.",
    body: "Compare the candidate with its parent. Check the existing application contract and the new capability before activation.",
  },
  {
    name: "The review",
    title: "Two decisions.\nBoth yours.",
    body: "Approve the model change. Then review the extracted facts. An active concept does not automatically make its assertions accepted.",
  },
  {
    name: "The record",
    title: "A useful record.\nA source you can get back to.",
    body: "Read the accepted interpretation through a typed contract. The requirement stays reported, with its supporting message attached.",
  },
];
function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function Check() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
export function Story() {
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);
  const [chapter, setChapter] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [inspector, setInspector] = useState(false);
  useEffect(() => {
    const media = gsap.matchMedia();
    media.add(
      {
        motion:
          "(prefers-reduced-motion: no-preference) and (min-height: 700px)",
        reduced: "(prefers-reduced-motion: reduce), (max-height: 699px)",
      },
      (context) => {
        const reduce = Boolean(context.conditions?.reduced);
        setReduced(reduce);
        if (reduce) return;
        const element = root.current!;
        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: element,
            start: "top 90px",
            end: "bottom bottom",
            scrub: 0.7,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              const next = Math.min(4, Math.floor(self.progress * 5));
              setChapter((previous) => (previous === next ? previous : next));
            },
            onRefresh: (self) => {
              trigger.current = self;
            },
          },
        });
        trigger.current = timeline.scrollTrigger!;
        timeline.fromTo(
          ".story-progress-fill",
          { scaleX: 0 },
          { scaleX: 1, duration: 5, ease: "none" },
          0,
        );
        timeline.fromTo(
          ".source-highlight",
          { backgroundSize: "0% 1px" },
          { backgroundSize: "100% 1px", duration: 0.8, ease: "none" },
          0.1,
        );
        timeline.fromTo(
          ".story-flow-line",
          { strokeDashoffset: 220 },
          { strokeDashoffset: 0, duration: 0.7, ease: "none" },
          0.5,
        );
        return () => {
          timeline.kill();
          trigger.current = null;
        };
      },
    );
    return () => media.revert();
  }, []);
  useEffect(() => {
    if (reduced) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        ".story-narrative-content",
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.45,
          ease: "power2.out",
          overwrite: true,
        },
      );
      gsap.fromTo(
        ".story-stage-content",
        { opacity: 0, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "power2.out",
          overwrite: true,
        },
      );
    }, root);
    return () => context.revert();
  }, [chapter, reduced]);
  function navigate(index: number) {
    if (reduced || !trigger.current) {
      setChapter(index);
      return;
    }
    const t = trigger.current;
    gsap.to(window, {
      scrollTo: t.start + (t.end - t.start) * ((index + 0.18) / 5),
      duration: 0.8,
      ease: "power2.inOut",
      overwrite: "auto",
    });
  }
  return (
    <section
      className={`story-section frame ${reduced ? "reduced-story" : ""}`}
      id="walkthrough"
      ref={root}
      aria-label="From source message to accepted record"
    >
      <div className="story-sticky">
        <div className="story-heading">
          <h2>
            One message.
            <br />
            <span>A new concept.</span>
          </h2>
          <div className="story-narrative">
            <div className="story-narrative-content" key={chapter}>
              <h3>
                {chapters[chapter].title.split("\n").map((line, i) => (
                  <React.Fragment key={line}>
                    {i > 0 && (
                      <>
                        <br />{" "}
                      </>
                    )}
                    {line}
                  </React.Fragment>
                ))}
              </h3>
              <p>{chapters[chapter].body}</p>
            </div>
          </div>
        </div>
        <div className="story-application">
          <div className="story-app-chrome">
            <div className="story-app-title">
              <span className="app-mark">◇</span>
              <span>Installation workspace</span>
            </div>
            <span className="story-chrome-state">
              {chapter < 3 ? "Your current model" : "Model v2"}
              <i />{" "}
              {chapter < 3
                ? "Proposed changes stay separate"
                : "Explicitly adopted"}
            </span>
          </div>
          <div className="story-workspace">
            <div className="story-source">
              <div className="story-source-head">
                <span className="source-avatar">R</span>
                <div>
                  <strong>Ramesh</strong>
                  <span>Message 014</span>
                </div>
                <span className="source-time">09:41</span>
              </div>
              <p className="story-message">
                Before we install the panels,
                <br />
                Ramesh needs to{" "}
                <span className="source-highlight">inspect the roof.</span>
              </p>
              <div className="source-preserved">
                <Check /> <span>Original message preserved</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="source-inspector-button"
                aria-expanded={inspector}
                onClick={() => setInspector(!inspector)}
              >
                {inspector ? "Close source details" : "Inspect the source"}{" "}
                <Arrow />
              </Button>
              {inspector && (
                <div className="source-inspector">
                  <span>message.txt · UTF-8 text</span>
                  <p>
                    “inspect the roof” is the supporting quote. Ontave derives
                    exact source coordinates during validation.
                  </p>
                </div>
              )}
            </div>
            <div className="story-connection" aria-hidden="true">
              <svg viewBox="0 0 220 100" preserveAspectRatio="none">
                <path d="M0 50H220" stroke="#303035" />
                <path
                  className="story-flow-line"
                  d="M0 50H220"
                  stroke="#a0a0a9"
                  strokeDasharray="220"
                />
                <circle cx="216" cy="50" r="3" fill="#c6c6ce" />
              </svg>
            </div>
            <div className="story-model">
              <div
                className="story-stage-content"
                key={chapter}
                aria-live="polite"
              >
                {chapter === 0 && (
                  <>
                    <div className="stage-heading">
                      <span>Current model</span>
                      <Badge variant="outline">v1</Badge>
                    </div>
                    <div className="existing-model">
                      <div className="model-concept">
                        <span>○</span> Person
                      </div>
                      <span className="model-connection-line" />
                      <div className="model-concept">
                        <span>□</span> Installation
                      </div>
                    </div>
                    <div className="model-gap">
                      <span>?</span>
                      <p>Where does an inspection fit?</p>
                    </div>
                    <p className="stage-footnote">
                      The source is kept, including what does not fit.
                    </p>
                  </>
                )}
                {(chapter === 1 || chapter === 2) && (
                  <>
                    <div className="stage-heading">
                      <span>
                        {chapter === 1
                          ? "Proposed addition"
                          : "Candidate evaluation"}
                      </span>
                      <Badge variant="outline">Not applied</Badge>
                    </div>
                    <Card className="story-new-concept">
                      <div className="new-concept-heading">
                        <span className="concept-shape">◇</span>
                        <h4>RoofInspection</h4>
                        <span className="concept-add">+</span>
                      </div>
                      <div className="new-concept-relation">
                        <span>RoofInspection</span>
                        <span>
                          precedes <Arrow />
                        </span>
                        <span>Installation</span>
                      </div>
                      <div className="new-concept-source">
                        Source <span>Message 014 ↗</span>
                      </div>
                    </Card>
                    {chapter === 1 ? (
                      <p className="stage-footnote">
                        A proposal grounded in the message. No automatic write.
                      </p>
                    ) : (
                      <div className="story-proof-lines">
                        <div>
                          <Check />
                          <span>Existing contract remains compatible</span>
                        </div>
                        <div>
                          <Check />
                          <span>New capability checked against evidence</span>
                        </div>
                        <p>
                          Illustrative checks. Inspect the actual evaluation
                          report before approval.
                        </p>
                      </div>
                    )}
                  </>
                )}
                {chapter === 3 && (
                  <>
                    <div className="stage-heading">
                      <span>Review decisions</span>
                      <Badge variant="outline">Your application</Badge>
                    </div>
                    <div className="review-decision">
                      <div className="decision-check">
                        <Check />
                      </div>
                      <div>
                        <span>Model change</span>
                        <strong>Add RoofInspection</strong>
                        <small>Candidate evaluated and approved</small>
                      </div>
                    </div>
                    <div className="review-decision">
                      <div className="decision-check">
                        <Check />
                      </div>
                      <div>
                        <span>Extracted assertion</span>
                        <strong>An inspection is required</strong>
                        <small>Source checked and bundle accepted</small>
                      </div>
                    </div>
                    <p className="stage-footnote">
                      Accepted interpretation. Still a reported requirement.
                    </p>
                  </>
                )}
                {chapter === 4 && (
                  <>
                    <div className="stage-heading">
                      <span>Accepted record</span>
                      <Badge variant="outline">Typed result</Badge>
                    </div>
                    <div className="accepted-record">
                      <div className="accepted-record-title">
                        <span>◇</span>
                        <strong>RoofInspection</strong>
                        <span>reported</span>
                      </div>
                      <div className="record-field">
                        <span>requirement</span>
                        <strong>inspect the roof</strong>
                      </div>
                      <div className="record-field">
                        <span>state</span>
                        <code>value</code>
                      </div>
                      <div className="record-field">
                        <span>verification</span>
                        <code>reported</code>
                      </div>
                      <div className="record-field source">
                        <span>evidence</span>
                        <a href="/docs/evidence/">
                          Message 014 <Arrow />
                        </a>
                      </div>
                    </div>
                    <p className="stage-footnote">
                      Query approved data. No inference call needed.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="story-bottom">
          <nav className="story-chapters" aria-label="Walkthrough chapters">
            {chapters.map((item, index) => (
              <Button
                key={item.name}
                variant="ghost"
                size="sm"
                aria-current={chapter === index ? "step" : undefined}
                onClick={() => navigate(index)}
              >
                <span className="chapter-dot" />
                {item.name}
              </Button>
            ))}
          </nav>
          <span className="story-scroll-hint">
            {reduced ? "Select a chapter" : "Scroll to follow the story"}{" "}
            <span>↓</span>
          </span>
        </div>
        <div className="story-progress">
          <div className="story-progress-fill" />
        </div>
        <p className="story-disclaimer">
          An illustrative walkthrough of the review flow.
        </p>
      </div>
    </section>
  );
}
