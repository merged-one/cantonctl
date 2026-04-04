# Target Users

## App And Platform Engineers

### Job to be done

Move Daml artifacts and app code from sandbox or LocalNet into validator-backed Canton and Splice environments.

### How they are served today

DPM, Daml Studio, Quickstart, the dApp SDK, and stable/public Splice APIs already cover contract authoring and official integration paths.

### Gap `cantonctl` fills

Profile resolution, auth, compatibility, status, discovery, and stable/public operational checks across changing environments.

## Solution Engineers, DevRel, And Onboarding Leads

### Job to be done

Turn LocalNet and reference-app demos into repeatable setup flows and profile bundles.

### How they are served today

Quickstart and LocalNet docs provide the official starting point.

### Gap `cantonctl` fills

A project-local wrapper for the official LocalNet workspace plus repeatable profile-aware diagnostics and canaries.

## CI, Release, And Operations Engineers

### Job to be done

Turn remote-environment checks into JSON-first gates and support workflows.

### How they are served today

Mostly through ad hoc scripts, manual onboarding checklists, and direct API usage.

### Gap `cantonctl` fills

Machine-readable compatibility, preflight, diagnostics, discovery, and canary output on stable/public surfaces.
