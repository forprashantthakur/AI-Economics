import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import { PROVIDER_TIER_MAP, computeProject, type ProcessTemplate, type Project, type ProjectResult } from '@aies/engine';
import { Button, Callout, PageHeader, Panel, ReadOnlyNote } from '../components/ui';
import { navigate } from '../lib/router';
import { useCan, useStore, useTemplates } from '../state/store';
import { STEPS, buildProject, defaultForm, templateDefaults, validateStep, type Errors, type WizardForm } from './intake/form';
import { ClientStep, ReviewStep, SolutionStep, StepIndicator, TemplateStep, WorkloadStep } from './intake/steps';

/** Draft survives leaving the page within this session, so an accidental click does not lose the intake. */
let savedDraft: { form: WizardForm; step: number; edited: string[] } | null = null;

const STEP_HELP = [
  'Who the engagement is for. The currency is the reporting currency for every figure.',
  'Pick the business process. Its ABU definition is the unit the client will pay for and measure value against.',
  'How the AI solution is built. This sizes the implementation plan and selects models from the rate card.',
  'Steady-state volume and execution behaviour. These drive tokens, ACUs, run cost and the ABU price.',
  'The engine has built a complete project from your answers. Check the estimate, then create it.',
];

export function IntakeWizard() {
  const { state, dispatch } = useStore();
  const templates = useTemplates();
  const canCreate = useCan('project.create');
  const currencies = useMemo(() => [...new Set([state.catalog.fx.base, ...Object.keys(state.catalog.fx.rates)])], [state.catalog.fx]);
  const [form, setForm] = useState<WizardForm>(() => savedDraft?.form ?? defaultForm(currencies));
  const [step, setStep] = useState(savedDraft?.step ?? 0);
  const [edited, setEdited] = useState<Set<string>>(() => new Set(savedDraft?.edited ?? []));
  const [errors, setErrors] = useState<Errors>({});

  const created = useRef(false);
  useEffect(() => {
    if (!created.current) savedDraft = { form, step, edited: [...edited] };
  }, [form, step, edited]);

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setEdited((e) => (e.has(k) ? e : new Set(e).add(k)));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const pickTemplate = (t: ProcessTemplate) => {
    // Template defaults fill every field the user has not changed by hand.
    const d = templateDefaults(t);
    setForm((f) => {
      const next: WizardForm = { ...f, templateId: t.id };
      for (const [k, v] of Object.entries(d)) if (!edited.has(k)) (next as unknown as Record<string, unknown>)[k] = v;
      return next;
    });
    setErrors({});
  };

  const template = templates.find((t) => t.id === form.templateId);

  // Live engine build (cheap) for the workload step and the full computation for the review.
  const preview = useMemo<Project | undefined>(() => {
    if (!template) return undefined;
    try {
      return buildProject(form, state.catalog, templates, state.user.name, 'preview');
    } catch {
      return undefined;
    }
  }, [form, template, state.catalog, templates, state.user.name]);
  const result = useMemo<ProjectResult | undefined>(() => {
    if (step !== 4 || !preview) return undefined;
    try {
      return computeProject(preview, state.catalog, { packages: false });
    } catch {
      return undefined;
    }
  }, [step, preview, state.catalog]);

  const goTo = (target: number) => {
    if (target <= step) {
      setErrors({});
      setStep(Math.max(0, target));
      return;
    }
    for (let s = step; s < target; s++) {
      const e = validateStep(s, form, templates, currencies);
      if (Object.keys(e).length) {
        setErrors(e);
        setStep(s);
        return;
      }
    }
    setErrors({});
    setStep(target);
  };

  const create = () => {
    for (let s = 0; s < 4; s++) {
      const e = validateStep(s, form, templates, currencies);
      if (Object.keys(e).length) {
        setErrors(e);
        setStep(s);
        return;
      }
    }
    const project = buildProject(form, state.catalog, templates, state.user.name);
    dispatch({ type: 'addProject', project, action: 'Created project from intake' });
    created.current = true;
    savedDraft = null;
    navigate('project', project.id, 'overview');
  };

  const reset = () => {
    const f = defaultForm(currencies);
    setForm(f);
    setStep(0);
    setEdited(new Set());
    setErrors({});
  };

  const providerLabel = PROVIDER_TIER_MAP[form.provider]?.label ?? form.provider;
  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <div className="max-w-[1100px]">
      <PageHeader
        title="New project"
        description="Module 1, project intake. Five short steps turn a client conversation into a complete, computable estimate: workflow, agents, implementation plan, run-cost model, pricing and value baseline."
        actions={
          <>
            <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate('projects')}>
              Projects
            </Button>
            <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={reset}>
              Start over
            </Button>
          </>
        }
      />
      <ReadOnlyNote show={!canCreate} what="create projects" />

      <StepIndicator step={step} onJump={goTo} />

      <Panel title={`${step + 1}. ${STEPS[step].label}`} description={STEP_HELP[step]}>
        {errorCount > 0 && (
          <div className="mb-4">
            <Callout tone="bad">
              {errorCount === 1 ? 'One answer needs attention' : `${errorCount} answers need attention`} before you continue. The messages are shown next to each field.
            </Callout>
          </div>
        )}
        {step === 0 && (
          <ClientStep
            form={form}
            set={set}
            errors={errors}
            currencies={currencies}
            customIndustries={state.customIndustries}
            customFunctions={state.customFunctions}
            onAddIndustry={(v) => {
              dispatch({ type: 'setLists', industries: [...state.customIndustries, v], functions: state.customFunctions });
              dispatch({ type: 'audit', action: 'Added industry', detail: v, projectId: null });
            }}
          />
        )}
        {step === 1 && <TemplateStep form={form} set={set} errors={errors} templates={templates} onPick={pickTemplate} />}
        {step === 2 && <SolutionStep form={form} set={set} errors={errors} catalog={state.catalog} />}
        {step === 3 && <WorkloadStep form={form} set={set} errors={errors} template={template} preview={preview} />}
        {step === 4 && <ReviewStep form={form} template={template} result={result} provider={providerLabel} onEdit={goTo} />}

        <div className="flex flex-wrap items-center justify-between gap-3 mt-6 pt-4 border-t border-line-soft">
          <Button icon={<ArrowLeft size={15} />} onClick={() => goTo(step - 1)} disabled={step === 0}>
            Back
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-ink-3 num hidden sm:inline">
              Step {step + 1} of {STEPS.length}
            </span>
            {step < STEPS.length - 1 ? (
              <Button className="!text-brand-ink" variant="primary" onClick={() => goTo(step + 1)}>
                Next: {STEPS[step + 1].label.toLowerCase()}
              </Button>
            ) : (
              <Button className="!text-brand-ink" variant="primary" icon={<Check size={15} />} onClick={create} disabled={!canCreate || !result} title={canCreate ? undefined : 'Your role cannot create projects'}>
                Create project
              </Button>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
