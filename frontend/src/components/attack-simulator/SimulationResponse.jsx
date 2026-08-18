import { CheckCircle2 } from 'lucide-react';
import { Card, ConfidenceGauge, SkeletonLoader } from '../ui';

export default function SimulationResponse({ response }) {
  return (
    <Card
      className="simulation-response-card"
      title="AI Recommended Response"
      caption="Controlled simulation output; no external action is executed."
    >
      <div className="simulation-response-body">
        <ConfidenceGauge value={response.confidence} label={response.verdict} />
        <section
          className="simulation-recommendations"
          aria-label="Recommended response actions"
          aria-live="polite"
          aria-busy={response.confidence == null}
        >
          <h3>Recommended actions</h3>
          {response.actions.length ? (
            <ol>
              {response.actions.map((action, index) => (
                <li key={action} style={{ '--recommendation-index':index }}>
                  <span aria-hidden="true">{index + 1}</span>
                  <p>{action}</p>
                </li>
              ))}
            </ol>
          ) : <SkeletonLoader lines={3} className="simulation-response-skeleton" />}
        </section>
      </div>
      {response.complete && (
        <div className="simulation-complete-strip" role="status">
          <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden="true" />
          <strong>Simulation Complete</strong>
          <span>{response.summary}</span>
        </div>
      )}
    </Card>
  );
}
