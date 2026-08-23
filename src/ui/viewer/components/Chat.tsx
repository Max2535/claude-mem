import React, { useState, Dispatch, SetStateAction } from 'react';
import { ObservationCard } from './ObservationCard';
import { useMemoryChat } from '../hooks/useMemoryChat';
import { ChatTurn, describeWalk, plural, unmatchedSources } from '../utils/memoryWalk';
import { SearchObservation } from '../types';

interface ChatProps {
  currentFilter: string;
  turns: ChatTurn[];
  setTurns: Dispatch<SetStateAction<ChatTurn[]>>;
}

/** The card wants a source; a search row may not carry one. Match its own default. */
function withSource(observation: SearchObservation) {
  return { ...observation, platform_source: observation.platform_source || 'claude' };
}

function TurnBody({ turn }: { turn: ChatTurn }) {
  if (turn.state === 'walking') {
    return (
      <div className="chat-walk" aria-live="polite">
        <div className="chat-step chat-step-pending"><span className="chat-skeleton" /></div>
        <div className="chat-step chat-step-pending"><span className="chat-skeleton" /></div>
      </div>
    );
  }

  if (turn.state === 'stopped') {
    return <p className="chat-turn-note">Stopped waiting. The worker may still be finishing this one in the background.</p>;
  }

  if (turn.state === 'error') {
    return <p className="chat-turn-error">Could not answer: {turn.error}</p>;
  }

  const unmatched = turn.coverage ? unmatchedSources(turn.coverage) : [];

  return (
    <>
      {turn.note && <p className="chat-turn-note">{turn.note}</p>}

      {turn.traversal && (
        <ol className="chat-walk">
          {describeWalk(turn.traversal, turn.observations.length, turn.coverage).map(step => (
            <li key={step.label} className="chat-step">
              <span className="chat-step-label">{step.label}</span>
              <span className="chat-step-detail">{step.detail}</span>
            </li>
          ))}
        </ol>
      )}

      {unmatched.length > 0 && (
        <p className="chat-turn-note">
          Indexed but never picked: {unmatched.join(', ')}.
        </p>
      )}

      {turn.omitted && (turn.omitted.sessions > 0 || turn.omitted.prompts > 0) && (
        <p className="chat-turn-note">
          {plural(turn.omitted.sessions, 'session summary', 'session summaries')} and {plural(turn.omitted.prompts, 'prompt')} also matched; this screen shows observations only.
        </p>
      )}

      {turn.observations.length === 0 ? (
        <p className="chat-turn-note">No observations matched.</p>
      ) : (
        <div className="chat-results">
          {turn.observations.map(observation => (
            <ObservationCard key={observation.id} observation={withSource(observation)} />
          ))}
        </div>
      )}
    </>
  );
}

export function Chat({ currentFilter, turns, setTurns }: ChatProps) {
  const [question, setQuestion] = useState('');
  const { ask, stop } = useMemoryChat(currentFilter, setTurns);

  const isBusy = turns.some(turn => turn.state === 'walking');

  return (
    <div className="page chat">
      <header className="page-head">
        <h1 className="page-title">Chat</h1>
        <p className="page-subtitle">Ask your memory a question and watch the retrieval walk that answered it</p>
      </header>

      <form
        className="chat-composer"
        onSubmit={event => {
          event.preventDefault();
          if (isBusy) return;
          void ask(question);
          setQuestion('');
        }}
      >
        <input
          className="chat-input"
          type="text"
          value={question}
          placeholder="What did I change about the Explorer tree?"
          onChange={event => setQuestion(event.target.value)}
          disabled={isBusy}
          aria-label="Question"
        />
        {isBusy ? (
          <button type="button" className="chat-submit" onClick={stop}>Stop waiting</button>
        ) : (
          <button type="submit" className="chat-submit" disabled={!question.trim()}>Ask</button>
        )}
      </form>

      {/* The traversal is stateless by design — no resume between calls — so a
          follow-up that leans on the previous answer would silently get nothing. */}
      <p className="chat-hint">Every question is answered on its own. The walk carries nothing over from the last one.</p>

      {turns.length === 0 ? (
        <div className="chat-empty">Nothing asked yet.</div>
      ) : (
        <ol className="chat-turns">
          {turns.map(turn => (
            <li key={turn.id} className="chat-turn">
              <div className="chat-turn-head">
                <span className="chat-turn-question">{turn.question}</span>
                {turn.source && (
                  <span className={`chat-turn-badge is-${turn.source}`}>
                    {turn.source === 'walk' ? 'retrieval walk' : 'keyword search'}
                  </span>
                )}
              </div>
              <TurnBody turn={turn} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
