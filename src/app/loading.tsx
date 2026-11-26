export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading workspace">
      <div className="card row-between" style={{ padding: '16px 20px' }}>
        <div className="row" style={{ gap: 12, flex: 1 }}>
          <div className="skel skel-pill" style={{ width: 120 }} />
          <div className="skel skel-pill" style={{ width: 160 }} />
          <div className="skel skel-pill" style={{ width: 110 }} />
        </div>
        <div className="skel skel-pill" style={{ width: 96 }} />
      </div>

      <div className="grid-split">
        <div className="card stack">
          <div className="row-between">
            <div className="skel skel-line" style={{ width: '38%', height: 22 }} />
            <div className="skel skel-pill" style={{ width: 120 }} />
          </div>
          <div className="skel skel-box" style={{ height: 420 }} />
        </div>
        <div className="card stack">
          <div className="skel skel-line" style={{ width: '55%', height: 22 }} />
          <div className="skel skel-line" style={{ width: '100%', height: 38 }} />
          <div className="skel skel-line" style={{ width: '100%', height: 38 }} />
          <div className="skel skel-box" style={{ height: 140 }} />
          <div className="skel skel-line" style={{ width: '100%', height: 44, borderRadius: 12 }} />
        </div>
      </div>
    </div>
  );
}
