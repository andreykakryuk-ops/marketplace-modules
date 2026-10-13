import type {Item} from './types';
export function canonicalArticle(article:string,mapping:Record<string,string>,items:Item[]){
 const target=mapping[article];if(!target)return article;
 const item=items.find(i=>i.id===target&&i.stockKind==='finished');if(!item)throw Error('ARTICLE_MAPPING_BROKEN');
 return item.sku;
}
