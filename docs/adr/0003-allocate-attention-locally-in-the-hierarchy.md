# Allocate attention locally in the hierarchy

Attention is allocated among visible siblings within each parent, with overall shares derived through the hierarchy. Resizing a topic preserves the relative allocations inside its branches and must not require rewriting potentially hundreds of descendant allocations, including those in other topics. This keeps changes local both in their planning meaning and in the allocation data they affect.
