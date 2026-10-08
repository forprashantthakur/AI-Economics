import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { uid, type ProjectResult, type RevenueStream, type StreamType } from '@aies/engine';
import { Badge, Button, Checkbox, NumberInput, Panel, Select, TextInput, Toggle, cx } from '../../components/ui';
import { DEFAULT_STREAM_LABEL, STREAM_TYPE_LABEL, STREAM_TYPE_OPTIONS, priceText, usesMargin, type Updater } from './shared';

export function StreamBuilder({ r, update, canEdit }: { r: ProjectResult; update: Updater; canEdit: boolean }) {
  const cur = r.currency;
  const pricing = r.project.pricing;
  const streams = pricing.streams;
  const [newType, setNewType] = useState<StreamType>('agentops');

  const edit = (id: string, action: string, fn: (s: RevenueStream) => void) =>
    update(action, (d) => {
      const s = d.pricing.streams.find((x) => x.id === id);
      if (s) fn(s);
    });

  const changeType = (s: RevenueStream, type: StreamType) =>
    edit(s.id, `Changed stream type of "${s.label}"`, (x) => {
      if (x.label === DEFAULT_STREAM_LABEL[x.type]) x.label = DEFAULT_STREAM_LABEL[type];
      x.type = type;
      // A one-time fee can only recover implementation cost.
      // Other combinations are left as configured; the engine flags anything invalid.
      if (type === 'fixed_fee') x.recovers = x.recovers.filter((p) => p === 'IMPLEMENTATION');
      if (!usesMargin(type)) x.targetMarginPct = 0;
    });

  const add = () =>
    update(`Added ${STREAM_TYPE_LABEL[newType].toLowerCase()} stream`, (d) => {
      d.pricing.streams.push({
        id: uid('s'),
        type: newType,
        label: DEFAULT_STREAM_LABEL[newType],
        enabled: true,
        recovers: [],
        targetMarginPct: usesMargin(newType) ? 30 : 0,
        discountPct: 0,
      });
    });

  return (
    <Panel
      title="Revenue streams"
      description="The hybrid commercial model for this project. Each stream recovers the cost pools ticked in the matrix below; prices are derived by the engine from that cost at the target margin."
      padded={false}
      actions={r.issues.some((i) => i.code === 'SAMPLE_RATES') ? <Badge tone="warn">Sample rates</Badge> : undefined}
    >
      <div className="scroll-x">
        <table className="dtable min-w-[900px]">
          <thead>
            <tr>
              <th className="w-[72px]">On</th>
              <th>Label</th>
              <th>Type</th>
              <th className="r">Target margin</th>
              <th className="r">Discount</th>
              <th className="r">Engine price</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {streams.map((s) => {
              const sp = r.priceBook.streams.find((x) => x.streamId === s.id);
              return (
                <tr key={s.id} className={cx(!s.enabled && 'opacity-60')}>
                  <td>
                    <Toggle checked={s.enabled} disabled={!canEdit} onChange={(v) => edit(s.id, `${v ? 'Enabled' : 'Disabled'} stream "${s.label}"`, (x) => (x.enabled = v))} />
                  </td>
                  <td className="min-w-[220px]">
                    <TextInput
                      value={s.label}
                      ariaLabel="Stream label"
                      disabled={!canEdit}
                      onChange={(v) => edit(s.id, 'Renamed revenue stream', (x) => (x.label = v || DEFAULT_STREAM_LABEL[x.type]))}
                    />
                    {s.type === 'fixed_fee' && (
                      <div className="mt-1">
                        <Checkbox
                          checked={s.useImplementationPlanPrice !== false}
                          disabled={!canEdit}
                          label={<span className="text-[12.5px]">Price from the implementation plan</span>}
                          onChange={(v) => edit(s.id, 'Changed implementation fee basis', (x) => (x.useImplementationPlanPrice = v))}
                        />
                      </div>
                    )}
                  </td>
                  <td className="min-w-[210px]">
                    <Select<StreamType> value={s.type} ariaLabel="Stream type" options={STREAM_TYPE_OPTIONS} disabled={!canEdit} onChange={(v) => changeType(s, v)} />
                  </td>
                  <td className="r">
                    {usesMargin(s.type) ? (
                      <NumberInput
                        value={s.targetMarginPct}
                        suffix="%"
                        min={0}
                        max={95}
                        width={96}
                        className="ml-auto"
                        ariaLabel={`Target margin for ${s.label}`}
                        disabled={!canEdit || (s.type === 'fixed_fee' && s.useImplementationPlanPrice !== false)}
                        onChange={(v) => edit(s.id, `Changed target margin of "${s.label}"`, (x) => (x.targetMarginPct = v))}
                      />
                    ) : (
                      <span className="text-ink-3 text-[13px]">Not margin-priced</span>
                    )}
                  </td>
                  <td className="r">
                    {usesMargin(s.type) ? (
                      <NumberInput
                        value={s.discountPct}
                        suffix="%"
                        min={0}
                        max={100}
                        width={88}
                        className="ml-auto"
                        ariaLabel={`Discount for ${s.label}`}
                        disabled={!canEdit || (s.type === 'fixed_fee' && s.useImplementationPlanPrice !== false)}
                        onChange={(v) => edit(s.id, `Changed discount of "${s.label}"`, (x) => (x.discountPct = v))}
                      />
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="r whitespace-nowrap">
                    <div className="font-semibold num">{priceText(s, sp, cur, pricing.passThroughMarkupPct, pricing.gainshare.sharePct)}</div>
                    <div className="flex justify-end gap-1 mt-0.5">
                      {sp?.floorApplied && <Badge tone="warn">floor applied</Badge>}
                      {sp?.overridden && <Badge tone="brand">negotiated</Badge>}
                      {s.type === 'abu' && sp?.abu && Object.values(sp.abu.byWorkflow).some((w) => w.floorApplied) && <Badge tone="warn">floor applied</Badge>}
                    </div>
                  </td>
                  <td className="r">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${s.label}`}
                      title="Remove stream"
                      disabled={!canEdit}
                      onClick={() => update(`Removed stream "${s.label}"`, (d) => (d.pricing.streams = d.pricing.streams.filter((x) => x.id !== s.id)))}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {streams.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-ink-3 py-6">
                  No revenue streams yet. Add one below, or pick a ready-made model from the comparison further down.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-line-soft">
        <div className="w-full sm:w-[260px]">
          <Select<StreamType> value={newType} ariaLabel="New stream type" options={STREAM_TYPE_OPTIONS} disabled={!canEdit} onChange={setNewType} />
        </div>
        <Button icon={<Plus size={15} />} disabled={!canEdit} onClick={add}>
          Add stream
        </Button>
        <span className="text-[12.5px] text-ink-3">Implementation-plan pricing sets the fee's margin and discount in Project Costing.</span>
      </div>
    </Panel>
  );
}
