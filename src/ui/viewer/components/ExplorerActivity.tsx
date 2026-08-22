import React, { useMemo } from 'react';
import { ActivityTimeline, TimelineLane, truncate } from './ActivityTimeline';
import { ExplorerDayObservation } from '../types';

/**
 * A fixed order, so a lane does not move between days the way a
 * sort-by-count would. Only the types a day actually holds get a lane —
 * six lanes with four of them empty is a chart about nothing.
 */
const TYPE_ORDER = ['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change'] as const;

function laneRank(type: string): number {
  const index = TYPE_ORDER.indexOf(type as typeof TYPE_ORDER[number]);
  // An unrecognised type sorts after the known ones rather than vanishing.
  return index === -1 ? TYPE_ORDER.length : index;
}

export function ExplorerActivity({ observations }: { observations: ExplorerDayObservation[] }) {
  const lanes: TimelineLane[] = useMemo(() => {
    const byType = new Map<string, TimelineLane>();
    for (const observation of observations) {
      const type = observation.type || 'other';
      if (!byType.has(type)) {
        // Every mark is an observation, so a second hue per lane would encode
        // nothing the lane label does not already say.
        byType.set(type, { key: type, label: type, tone: 'observation', marks: [] });
      }
      byType.get(type)!.marks.push({
        epoch: observation.createdAt,
        label: truncate(observation.title ?? observation.subtitle),
      });
    }
    return [...byType.values()].sort((a, b) => laneRank(a.key) - laneRank(b.key) || a.key.localeCompare(b.key));
  }, [observations]);

  return (
    <ActivityTimeline
      lanes={lanes}
      title="This day"
      defaultWindow="all"
      emptyMessage="Nothing recorded on this day."
    />
  );
}
