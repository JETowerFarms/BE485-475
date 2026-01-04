# Site-prep pricing equations (deterministic + probabilistic)

This document records the **price calculation equations** for site preparation, expressed in a way that is compatible with the current inputs used by the app:

- NLCD class breakdown: `classBreakdown.classes[]` with `percent` and `group`
- Pricing snapshot:
  - MSU per-acre operation totals: `pricingSnapshot.sources.msu.extractedRatesUsdPerAcre[operationKey]`
  - MDOT weighted-average bid items: `pricingSnapshot.sources.mdot.extractedItems[itemKey].avgAwardPriceUsd`

It also records a **more detailed probabilistic** equation set (same structure, but with random variables for quantities / mixture models).

---

## 0) Notation (shared)

Farm inputs:

- $A$ = total farm area (acres)
- NLCD produces landcover **groups** $g\in\mathcal{G}$ via `NLCD_CLASS_INFO[*].group`.
- Let $p_g$ = fraction of the farm area in group $g$ (dimensionless, sums to 1 over groups).
- Group area:
  $$A_g = A\,p_g$$

Unit prices from the pricing snapshot:

- MSU: $u_{\text{MSU}}(o)$ = USD/acre for MSU operation key $o$.
  - Source: `pricingSnapshot.sources.msu.extractedRatesUsdPerAcre[o]`
- MDOT: $u_{\text{MDOT}}(i)$ = USD/unit for MDOT item key $i$.
  - Source: `pricingSnapshot.sources.mdot.extractedItems[i].avgAwardPriceUsd`

Expectation operator: $\mathbb{E}[\cdot]$.

Total expected site-prep cost:

- $$C_{\text{total}} = \sum_{g\in\mathcal{G}} C_g$$

Priced-area per-acre (as in current implementation):

- Let `priced=true` groups be $\mathcal{G}_{\text{priced}}$.
- $$A_{\text{priced}} = \sum_{g\in\mathcal{G}_{\text{priced}}} A_g$$
- $$C_{\text{perAcre}} = \frac{C_{\text{total}}}{A_{\text{priced}}}\quad (A_{\text{priced}}>0)$$

---

## 1) Group aggregation from NLCD percents

NLCD classes $k$ map to groups $g$.

- Convert class percent (in %) to fraction:
  $$p_k = \frac{\text{percent}_k}{100}$$
- Group fraction:
  $$p_g = \sum_{k\in\mathcal{K}(g)} p_k$$
- Group area:
  $$A_g = A\,p_g$$

---

## 2) MSU-priced groups (ag/grass/shrub/barren/unknown)

### 2.1 Deterministic (current structure)

For any group $g$ that is priced via MSU operation key $o(g)$:

- $$C_g = A_g\cdot u_{\text{MSU}}(o(g))$$

In code, `o(g)` is from `SITE_PREP_MODEL_BY_GROUP[g].operation` for non-MDOT groups.

### 2.2 Probabilistic mixture of MSU operations

If a group can be treated as a **mixture of multiple MSU operations**:

- Let $O_g\in\{o_1,\dots,o_m\}$ with probabilities $\pi_{g,j}$, $\sum_j\pi_{g,j}=1$.

Expected group cost:

- $$\mathbb{E}[C_g]=A_g\cdot\sum_{j=1}^m\pi_{g,j}\,u_{\text{MSU}}(o_j)$$

(Optionally) variance of the categorical mixture term:

- $$\mathrm{Var}(C_g)=A_g^2\left(\sum_j\pi_{g,j}u_{\text{MSU}}(o_j)^2-\left(\sum_j\pi_{g,j}u_{\text{MSU}}(o_j)\right)^2\right)$$

---

## 3) Developed land (MDOT bid items)

Let $A_d$ = developed area in acres ($A_{\text{developed}}$).

### 3.1 Conversions (same as current constants)

- $1$ acre $= 4840$ Syd
- $1$ acre $= 43560$ Sft
- $1$ acre-foot $= 1613.\overline{3}$ Cyd

### 3.2 Deterministic developed quantities (current implementation)

Current constants from `DEVELOPED_ASSUMPTIONS`:

- $f_{\text{imp}} = 0.5$ (imperviousRemovalFraction)
- $d_{\text{cut}} = 0.5$ ft (earthworkCutDepthFt)

MDOT item keys used by the app (if present in snapshot):

- `clearingAndGrubbing` (Acr)
- `pavementRemoval` (Syd)
- `concreteRemovalSyd` (Syd) and/or `concreteRemovalSft` (Sft)
- `earthExcavation` (Cyd)

Deterministic quantities:

- Clearing & grubbing (Acr):
  $$Q_{\text{C\&G}}=A_d$$

- Pavement removal (Syd):
  $$Q_{\text{pav,syd}}=A_d\cdot 4840\cdot f_{\text{imp}}$$

- Concrete removal (Syd) (half of impervious removal fraction, per current logic):
  $$Q_{\text{conc,syd}}=A_d\cdot 4840\cdot \frac{f_{\text{imp}}}{2}$$

- Concrete removal (Sft) alternative:
  $$Q_{\text{conc,sft}}=A_d\cdot 43560\cdot \frac{f_{\text{imp}}}{2}$$

- Earth excavation (Cyd):
  $$Q_{\text{earth,cyd}}=A_d\cdot 1613.\overline{3}\cdot d_{\text{cut}}$$

Deterministic developed cost (sum of any available items):

- $$C_{\text{developed}} = \sum_{i\in\mathcal{I}_d} u_{\text{MDOT}}(i)\cdot Q_i$$

Where $\mathcal{I}_d$ is the subset of the above developed item keys found in the pricing snapshot.

### 3.3 Probabilistic developed quantities (more detailed)

Replace fixed constants with random variables:

- Impervious fraction:
  $$F_{\text{imp}}\sim\mathrm{Beta}(\alpha_{\text{imp}},\beta_{\text{imp}})\in[0,1]$$

- Split of impervious into asphalt vs. concrete shares:
  $$S_{\text{asph}}\sim\mathrm{Beta}(\alpha_a,\beta_a),\qquad S_{\text{conc}}=1-S_{\text{asph}}$$

- Thickness (ft), if you later add volume-based disposal/haul items:
  $$T_{\text{asph}}\sim\mathrm{LogNormal}(\mu_a,\sigma_a),\qquad T_{\text{conc}}\sim\mathrm{LogNormal}(\mu_c,\sigma_c)$$

- Earthwork cut depth mixture (ft):
  $$D_{\text{cut}}\sim w_1\,\mathrm{LogNormal}(\mu_1,\sigma_1)+w_2\,\mathrm{LogNormal}(\mu_2,\sigma_2),\quad w_1+w_2=1$$

Probabilistic quantities (area-based removal items):

- $$Q_{\text{C\&G}} = A_d$$
- $$Q_{\text{pav,syd}} = A_d\cdot 4840\cdot F_{\text{imp}}\cdot S_{\text{asph}}$$
- $$Q_{\text{conc,syd}} = A_d\cdot 4840\cdot F_{\text{imp}}\cdot S_{\text{conc}}$$
- $$Q_{\text{earth,cyd}} = A_d\cdot 1613.\overline{3}\cdot D_{\text{cut}}$$

(If later needed) volumetric removal (Cyd):

- $$V_{\text{asph,cyd}} = A_d\cdot 1613.\overline{3}\cdot F_{\text{imp}}\cdot S_{\text{asph}}\cdot T_{\text{asph}}$$
- $$V_{\text{conc,cyd}} = A_d\cdot 1613.\overline{3}\cdot F_{\text{imp}}\cdot S_{\text{conc}}\cdot T_{\text{conc}}$$

Expected developed cost (using existing MDOT item keys):

- $$\mathbb{E}[C_{\text{developed}}] = \sum_{i\in\mathcal{I}_d} u_{\text{MDOT}}(i)\cdot \mathbb{E}[Q_i]$$

Simple independence approximation (optional):

- $$\mathbb{E}[Q_{\text{pav,syd}}]\approx A_d\cdot 4840\cdot \mathbb{E}[F_{\text{imp}}]\cdot \mathbb{E}[S_{\text{asph}}]$$
- $$\mathbb{E}[Q_{\text{conc,syd}}]\approx A_d\cdot 4840\cdot \mathbb{E}[F_{\text{imp}}]\cdot (1-\mathbb{E}[S_{\text{asph}}])$$
- $$\mathbb{E}[Q_{\text{earth,cyd}}]=A_d\cdot 1613.\overline{3}\cdot \mathbb{E}[D_{\text{cut}}]$$

---

## 4) Vegetation (forest + wetlands) (MDOT per-each items)

Let $A_v$ = vegetation area in acres (e.g., forest + wetlands groups).

MDOT item keys used by the app (if present in snapshot):

- `treeRemoval6to18` (Ea)
- `stumpRemoval6to18` (Ea)

### 4.1 Deterministic vegetation quantities (current implementation)

Current constants from `VEGETATION_ASSUMPTIONS`:

- $n_{\text{trees}} = 50$ trees/acre (treesRemovedPerAcre)
- $s_{\text{stumps}} = 1$ stump/tree (stumpsRemovedPerTree)

Deterministic quantities:

- Trees removed (Ea):
  $$Q_{\text{tree}} = A_v\cdot n_{\text{trees}}$$

- Stumps removed (Ea):
  $$Q_{\text{stump}} = Q_{\text{tree}}\cdot s_{\text{stumps}}$$

Deterministic vegetation cost (sum of items that exist in the snapshot):

- $$C_{\text{veg}} = u_{\text{MDOT}}(\texttt{treeRemoval6to18})\cdot Q_{\text{tree}} + u_{\text{MDOT}}(\texttt{stumpRemoval6to18})\cdot Q_{\text{stump}}$$

### 4.2 Probabilistic vegetation model (multiple forms via diameter mixtures)

Tree density per acre (overdispersed example):

- $$N\sim\mathrm{NegBin}(r,p)\quad\text{(trees/acre)}$$

Diameter classes $c\in\{1,\dots,C\}$ with class probabilities $\pi_c$, $\sum_c\pi_c=1$.

- $$\mathbf{N}_{\text{class}}\mid N \sim \mathrm{Multinomial}(N,\boldsymbol{\pi})$$

Removal probability by class:

- $$N^{\text{rem}}_c\mid N_c\sim\mathrm{Binomial}(N_c,\rho_c)$$

Stump probability per removed tree by class:

- $$N^{\text{stump}}_c\mid N^{\text{rem}}_c\sim\mathrm{Binomial}(N^{\text{rem}}_c,\sigma_c)$$

Unit prices by diameter class $u_{\text{tree},c}$, $u_{\text{stump},c}$.

If only `treeRemoval6to18` / `stumpRemoval6to18` exist, map classes to those keys via multipliers $m_c$:

- $$u_{\text{tree},c}=m^{\text{tree}}_c\cdot u_{\text{MDOT}}(\texttt{treeRemoval6to18})$$
- $$u_{\text{stump},c}=m^{\text{stump}}_c\cdot u_{\text{MDOT}}(\texttt{stumpRemoval6to18})$$

Expected removed trees per acre in class $c$:

- $$\mathbb{E}[N^{\text{rem}}_c]=\mathbb{E}[N]\cdot\pi_c\cdot\rho_c$$

Expected stump removals per acre in class $c$:

- $$\mathbb{E}[N^{\text{stump}}_c]=\mathbb{E}[N]\cdot\pi_c\cdot\rho_c\cdot\sigma_c$$

Expected vegetation cost:

- $$\mathbb{E}[C_{\text{veg}}] = A_v\cdot\sum_{c=1}^C\left(u_{\text{tree},c}\cdot\mathbb{E}[N^{\text{rem}}_c] + u_{\text{stump},c}\cdot\mathbb{E}[N^{\text{stump}}_c]\right)$$

Equivalently:

- $$\mathbb{E}[C_{\text{veg}}]=A_v\cdot\mathbb{E}[N]\cdot\sum_{c=1}^C\left(u_{\text{tree},c}\,\pi_c\rho_c + u_{\text{stump},c}\,\pi_c\rho_c\sigma_c\right)$$

---

## 5) Water group

Water is assigned a $0$ site-prep estimate:

- $$C_{\text{water}}=0$$

---

## 6) Final rollups (deterministic or expected)

Deterministic total:

- $$C_{\text{total}}=\sum_{g\in\mathcal{G}} C_g$$

Expected total (probabilistic version):

- $$\mathbb{E}[C_{\text{total}}]=\sum_{g\in\mathcal{G}}\mathbb{E}[C_g]$$

Per-acre on priced area:

- $$C_{\text{perAcre}}=\frac{C_{\text{total}}}{A_{\text{priced}}}\quad (A_{\text{priced}}>0)$$
- $$\mathbb{E}[C_{\text{perAcre}}]=\frac{\mathbb{E}[C_{\text{total}}]}{A_{\text{priced}}}\quad (A_{\text{priced}}>0)$$
