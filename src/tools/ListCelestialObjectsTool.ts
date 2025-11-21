import { MCPTool } from 'mcp-framework';
import { z } from 'zod';
import { listCelestialObjects, STAR_CATALOG, DSO_CATALOG } from '../utils/astronomy.js';

interface ListCelestialObjectsInput {
  category?: string;
  limit?: number;
  offset?: number;
  minMagnitude?: number;
  constellation?: string;
}

class ListCelestialObjectsTool extends MCPTool<ListCelestialObjectsInput> {
  name = 'listCelestialObjects';
  description = "Lists available celestial objects that can be queried by other tools. Objects are grouped by category. You can request all objects, or filter by a specific category. This tool helps in discovering what objects are known to the system.";
  
  protected schema = {
    category: {
      type: z.string().optional(),
      description: "Optional. Filters the list by category. Valid categories are: 'planets' (for Solar System objects like Sun, Moon, and planets), 'stars', 'messier' (for Messier objects), 'ic' (for Index Catalogue objects), 'ngc' (for New General Catalogue objects), 'dso' (for all Deep Sky Objects, including Messier, IC, NGC, and others), or 'all' (to list objects from all available categories). If omitted, defaults to 'all'."
    },
    limit: {
      type: z.number().positive().optional(),
      description: "Optional. Maximum number of objects to return per category."
    },
    offset: {
      type: z.number().min(0).optional(),
      description: "Optional. Number of objects to skip before returning results per category."
    },
    minMagnitude: {
      type: z.number().optional(),
      description: "Optional. Include only objects with visual magnitude less than or equal to this value. Applies to stars and DSOs."
    },
    constellation: {
      type: z.string().optional(),
      description: "Optional. Filter stars and DSOs by IAU constellation code or name (case-insensitive)."
    }
  };

  async execute(params: ListCelestialObjectsInput) {
    try {
        const allCategoriesFromAstronomy = listCelestialObjects();
        const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : undefined;
        const offset = typeof params.offset === 'number' && params.offset >= 0 ? params.offset : 0;
        const minMag = typeof params.minMagnitude === 'number' ? params.minMagnitude : undefined;
        const constellation = params.constellation ? params.constellation.trim().toLowerCase() : undefined;

        const paginate = (items: string[]) => {
          if (limit === undefined) return items;
          const start = offset ?? 0;
          return items.slice(start, start + limit);
        };

        const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

        const buildStars = () => {
          const seen = new Set<string>();
          const names: string[] = [];
          for (const [, coords] of STAR_CATALOG.entries()) {
            if (minMag !== undefined) {
              if (typeof coords.magnitude !== 'number' || coords.magnitude > minMag) continue;
            }
            if (constellation) {
              if (!coords.constellation || coords.constellation.toLowerCase() !== constellation) continue;
            }
            const primary = coords.name ? coords.name.toLowerCase() : undefined;
            if (!primary) continue;
            if (seen.has(primary)) continue;
            seen.add(primary);
            names.push(capitalize(primary));
          }
          names.sort();
          const page = paginate(names);
          return { total: names.length, objects: page, pageInfo: { offset: offset ?? 0, limit: limit ?? names.length } };
        };

        const buildDsoByPrefix = (prefix: 'm' | 'ic' | 'ngc') => {
          const names: string[] = [];
          for (const key of DSO_CATALOG.keys()) {
            if (prefix === 'm' && /^m\d+$/i.test(key)) {
              const obj = DSO_CATALOG.get(key)!;
              if (minMag !== undefined && (typeof obj.magnitude !== 'number' || obj.magnitude > minMag)) continue;
              if (constellation && (!obj.constellation || obj.constellation.toLowerCase() !== constellation)) continue;
              names.push(capitalize(key));
            } else if (prefix === 'ic' && /^ic\d+$/i.test(key)) {
              const obj = DSO_CATALOG.get(key)!;
              if (minMag !== undefined && (typeof obj.magnitude !== 'number' || obj.magnitude > minMag)) continue;
              if (constellation && (!obj.constellation || obj.constellation.toLowerCase() !== constellation)) continue;
              names.push(capitalize(key));
            } else if (prefix === 'ngc' && /^ngc\d+$/i.test(key)) {
              const obj = DSO_CATALOG.get(key)!;
              if (minMag !== undefined && (typeof obj.magnitude !== 'number' || obj.magnitude > minMag)) continue;
              if (constellation && (!obj.constellation || obj.constellation.toLowerCase() !== constellation)) continue;
              names.push(capitalize(key));
            }
          }
          names.sort((a, b) => {
            const pa = prefix === 'm' ? parseInt(a.substring(1)) : prefix === 'ic' ? parseInt(a.substring(2)) : parseInt(a.substring(3));
            const pb = prefix === 'm' ? parseInt(b.substring(1)) : prefix === 'ic' ? parseInt(b.substring(2)) : parseInt(b.substring(3));
            return pa - pb;
          });
          const page = paginate(names);
          return { total: names.length, objects: page, pageInfo: { offset: offset ?? 0, limit: limit ?? names.length } };
        };

        const buildOtherDso = () => {
          const names: string[] = [];
          for (const key of DSO_CATALOG.keys()) {
            if (/^(m\d+|ic\d+|ngc\d+)$/i.test(key)) continue;
            const obj = DSO_CATALOG.get(key)!;
            if (minMag !== undefined && (typeof obj.magnitude !== 'number' || obj.magnitude > minMag)) continue;
            if (constellation && (!obj.constellation || obj.constellation.toLowerCase() !== constellation)) continue;
            names.push(capitalize(key));
          }
          names.sort();
          const page = paginate(names);
          return { total: names.length, objects: page, pageInfo: { offset: offset ?? 0, limit: limit ?? names.length } };
        };

        let relevantCategories: { category: string, objects: string[] }[] = [];

        if (params.category) {
            const requestedCategoryLower = params.category.toLowerCase();

            if (requestedCategoryLower === 'all') {
                const categoriesOut: any[] = [];
                for (const cat of allCategoriesFromAstronomy) {
                  if (cat.category === 'Stars') {
                    const s = buildStars();
                    categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
                  } else if (cat.category === 'Messier Objects') {
                    const s = buildDsoByPrefix('m');
                    categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
                  } else if (cat.category === 'IC Objects') {
                    const s = buildDsoByPrefix('ic');
                    categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
                  } else if (cat.category === 'NGC Objects') {
                    const s = buildDsoByPrefix('ngc');
                    categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
                  } else if (cat.category === 'Other Deep Sky Objects') {
                    const s = buildOtherDso();
                    categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects });
                  } else if (cat.category === 'Solar System Objects') {
                    const page = paginate(cat.objects);
                    categoriesOut.push({ category: cat.category, objectCount: page.length, objects: page, page: { offset: offset ?? 0, limit: limit ?? page.length } });
                  }
                }
                const totalObjects = categoriesOut.reduce((sum, c) => sum + c.objectCount, 0);
                return { totalCategories: categoriesOut.length, totalObjects, categories: categoriesOut };
            } else if (requestedCategoryLower === 'dso') {
                const parts = [
                  { name: 'Messier Objects', data: buildDsoByPrefix('m') },
                  { name: 'IC Objects', data: buildDsoByPrefix('ic') },
                  { name: 'NGC Objects', data: buildDsoByPrefix('ngc') },
                  { name: 'Other Deep Sky Objects', data: buildOtherDso() }
                ];
                const categories = parts.map(p => ({ category: p.name, objectCount: p.data.objects.length, objects: p.data.objects, page: p.data.pageInfo }));
                const totalObjectsDSO = categories.reduce((sum, c) => sum + c.objectCount, 0);
                return { totalCategories: categories.length, totalObjects: totalObjectsDSO, categories };
            } else {
                // For specific categories like 'planets', 'stars', 'messier', 'ic', 'ngc'
                const targetCategory = allCategoriesFromAstronomy.find(cat => {
                    if (requestedCategoryLower === 'planets' && cat.category === 'Solar System Objects') return true;
                    if (requestedCategoryLower === 'stars' && cat.category === 'Stars') return true;
                    if (requestedCategoryLower === 'messier' && cat.category === 'Messier Objects') return true;
                    if (requestedCategoryLower === 'ic' && cat.category === 'IC Objects') return true;
                    if (requestedCategoryLower === 'ngc' && cat.category === 'NGC Objects') return true;
                    return false;
                });

                if (!targetCategory) {
                    const userFriendlyCategories = ['planets', 'stars', 'messier', 'ic', 'ngc', 'dso', 'all'];
                    return {
                        message: `No objects found in category "${params.category}". Available categories: ${userFriendlyCategories.join(', ')}.`,
                        availableCategories: userFriendlyCategories
                    };
                }

                if (requestedCategoryLower === 'stars') {
                  const s = buildStars();
                  return { category: params.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo };
                }
                if (requestedCategoryLower === 'messier') {
                  const s = buildDsoByPrefix('m');
                  return { category: params.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo };
                }
                if (requestedCategoryLower === 'ic') {
                  const s = buildDsoByPrefix('ic');
                  return { category: params.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo };
                }
                if (requestedCategoryLower === 'ngc') {
                  const s = buildDsoByPrefix('ngc');
                  return { category: params.category, objectCount: s.objects.length, objects: s.objects };
                }
                const pageItems = paginate(targetCategory.objects);
                return { category: params.category, objectCount: pageItems.length, objects: pageItems, page: { offset: offset ?? 0, limit: limit ?? pageItems.length } };
            }
        } else {
            // Default behavior if no category parameter is provided (same as 'all')
            const categoriesOut: any[] = [];
            for (const cat of allCategoriesFromAstronomy) {
              if (cat.category === 'Stars') {
                const s = buildStars();
                categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
              } else if (cat.category === 'Messier Objects') {
                const s = buildDsoByPrefix('m');
                categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
              } else if (cat.category === 'IC Objects') {
                const s = buildDsoByPrefix('ic');
                categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
              } else if (cat.category === 'NGC Objects') {
                const s = buildDsoByPrefix('ngc');
                categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
              } else if (cat.category === 'Other Deep Sky Objects') {
                const s = buildOtherDso();
                categoriesOut.push({ category: cat.category, objectCount: s.objects.length, objects: s.objects, page: s.pageInfo });
              } else if (cat.category === 'Solar System Objects') {
                const pageItems = paginate(cat.objects);
                categoriesOut.push({ category: cat.category, objectCount: pageItems.length, objects: pageItems, page: { offset: offset ?? 0, limit: limit ?? pageItems.length } });
              }
            }
            const totalObjects = categoriesOut.reduce((sum, c) => sum + c.objectCount, 0);
            return { totalCategories: categoriesOut.length, totalObjects, categories: categoriesOut };
        }
    } catch (error: any) {
        throw new Error(`Failed to list celestial objects: ${error.message}`);
    }
    }
}

// Export the class directly (not an instance)
export default ListCelestialObjectsTool;