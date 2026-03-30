import { Notice, TFile } from 'obsidian';
import WordpressPlugin from './main';
import {
  WordPressAuthParams,
  WordPressClient,
  WordPressClientResult,
  WordPressClientReturnCode,
  WordPressMediaUploadResult,
  WordPressPostParams,
  WordPressPublishResult
} from './wp-client';
import { WpPublishModal } from './wp-publish-modal';
import { PostType, PostTypeConst, Term } from './wp-api';
import { ERROR_NOTICE_TIMEOUT, WP_DEFAULT_PROFILE_NAME } from './consts';
import { isPromiseFulfilledResult, isValidUrl, openWithBrowser, processFile, SafeAny, showError, } from './utils';
import { WpProfile } from './wp-profile';
import { AppState } from './app-state';
import { ConfirmCode, openConfirmModal } from './confirm-modal';
import fileTypeChecker from 'file-type-checker';
import { MatterData, Media } from './types';
import { openPostPublishedModal } from './post-published-modal';
import { openLoginModal } from './wp-login-modal';
import { isFunction } from 'lodash-es';

export abstract class AbstractWordPressClient implements WordPressClient {

  /**
   * Client name.
   */
  name = 'AbstractWordPressClient';

  protected constructor(
    protected readonly plugin: WordpressPlugin,
    protected readonly profile: WpProfile
  ) { }

  abstract publish(
    title: string,
    content: string,
    postParams: WordPressPostParams,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<WordPressPublishResult>>;

  abstract getCategories(
    certificate: WordPressAuthParams
  ): Promise<Term[]>;

  abstract getPostTypes(
    certificate: WordPressAuthParams
  ): Promise<PostType[]>;

  abstract validateUser(
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<boolean>>;

  abstract getTag(
    name: string,
    certificate: WordPressAuthParams
  ): Promise<Term>;

  abstract uploadMedia(
    media: Media,
    certificate: WordPressAuthParams
  ): Promise<WordPressClientResult<WordPressMediaUploadResult>>;

  protected needLogin(): boolean {
    return true;
  }

  private async getAuth(): Promise<WordPressAuthParams> {
    let auth: WordPressAuthParams = {
      username: null,
      password: null
    };
    try {
      if (this.needLogin()) {
        // Check if there's saved username and password
        if (this.profile.username && this.profile.password) {
          auth = {
            username: this.profile.username,
            password: this.profile.password
          };
          const authResult = await this.validateUser(auth);
          if (authResult.code !== WordPressClientReturnCode.OK) {
            throw new Error(this.plugin.i18n.t('error_invalidUser'));
          }
        }
      }
    } catch (error) {
      showError(error);
      const result = await openLoginModal(this.plugin, this.profile, async (auth) => {
        const authResult = await this.validateUser(auth);
        return authResult.code === WordPressClientReturnCode.OK;
      });
      auth = result.auth;
    }
    return auth;
  }

  private async checkExistingProfile(matterData: MatterData) {
    const { profileName } = matterData;
    const isProfileNameMismatch = profileName && profileName !== this.profile.name;
    if (isProfileNameMismatch) {
      const confirm = await openConfirmModal({
        message: this.plugin.i18n.t('error_profileNotMatch'),
        cancelText: this.plugin.i18n.t('profileNotMatch_useOld', {
          profileName: matterData.profileName
        }),
        confirmText: this.plugin.i18n.t('profileNotMatch_useNew', {
          profileName: this.profile.name
        })
      }, this.plugin);
      if (confirm.code !== ConfirmCode.Cancel) {
        delete matterData.postId;
        matterData.categories = this.profile.lastSelectedCategories ?? [ 1 ];
      }
    }
  }

  private async tryToPublish(params: {
    postParams: WordPressPostParams,
    auth: WordPressAuthParams,
    updateMatterData?: (matter: MatterData) => void,
  }): Promise<WordPressClientResult<WordPressPublishResult>> {
    const { postParams, auth, updateMatterData } = params;
    const { content: strippedContent, tags: hashTags } = extractTrailingHashtags(postParams.content);
    postParams.content = strippedContent;
    postParams.tags = [...new Set([...(postParams.tags ?? []), ...hashTags])];
    const tagTerms = await this.getTags(postParams.tags, auth);
    postParams.tags = tagTerms.map(term => term.id);
    await this.updatePostImages({
      auth,
      postParams
    });
    let html = AppState.markdownParser.render(postParams.content);
    if (this.plugin.settings.useGutenbergBlocks) {
      html = htmlToGutenbergBlocks(html);
    }
    const result = await this.publish(
      postParams.title ?? 'A post from Obsidian!',
      html,
      postParams,
      auth);
    if (result.code === WordPressClientReturnCode.Error) {
      throw new Error(this.plugin.i18n.t('error_publishFailed', {
        code: result.error.code as string,
        message: result.error.message
      }));
    } else {
      new Notice(this.plugin.i18n.t('message_publishSuccessfully'));
      // post id will be returned if creating, true if editing
      const postId = result.data.postId;
      if (postId) {
        // const modified = matter.stringify(postParams.content, matterData, matterOptions);
        // this.updateFrontMatter(modified);
        const file = this.plugin.app.workspace.getActiveFile();
        if (file) {
          await this.plugin.app.fileManager.processFrontMatter(file, fm => {
            fm.profileName = this.profile.name;
            fm.postId = postId;
            fm.postType = postParams.postType;
            if (postParams.postType === PostTypeConst.Post) {
              fm.categories = postParams.categories;
            }
            if (isFunction(updateMatterData)) {
              updateMatterData(fm);
            }
          });
        }

        if (this.plugin.settings.rememberLastSelectedCategories) {
          this.profile.lastSelectedCategories = (result.data as SafeAny).categories;
          await this.plugin.saveSettings();
        }

        if (this.plugin.settings.showWordPressEditConfirm) {
          openPostPublishedModal(this.plugin)
            .then(() => {
              openWithBrowser(`${this.profile.endpoint}/wp-admin/post.php`, {
                action: 'edit',
                post: postId
              });
            });
        }
      }
    }
    return result;
  }

  private async updatePostImages(params: {
    postParams: WordPressPostParams,
    auth: WordPressAuthParams,
  }): Promise<void> {
    const { postParams, auth } = params;

    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile === null) {
      throw new Error(this.plugin.i18n.t('error_noActiveFile'));
    }

    const uploadCache = new Map<string, string>(); // local src → uploaded WP URL
    const images = getImages(postParams.content);

    for (const img of images) {
      if (img.srcIsUrl) continue;

      const decodedSrc = decodeURI(img.src);

      let wpUrl = uploadCache.get(decodedSrc);
      if (!wpUrl) {
        // Use activeFile.path as sourcePath so relative links resolve correctly
        const imgFile = this.plugin.app.metadataCache.getFirstLinkpathDest(decodedSrc, activeFile.path);
        if (!(imgFile instanceof TFile)) continue;

        const content = await this.plugin.app.vault.readBinary(imgFile);
        const fileType = fileTypeChecker.detectFile(content);
        const result = await this.uploadMedia({
          mimeType: fileType?.mimeType ?? 'application/octet-stream',
          fileName: imgFile.name,
          content,
        }, auth);

        if (result.code !== WordPressClientReturnCode.OK) {
          const msg = result.error.code === WordPressClientReturnCode.ServerInternalError
            ? result.error.message
            : this.plugin.i18n.t('error_mediaUploadFailed', { name: imgFile.name });
          new Notice(msg, ERROR_NOTICE_TIMEOUT);
          continue;
        }

        wpUrl = result.data.url;
        uploadCache.set(decodedSrc, wpUrl);
      }

      // Replace in publishing content using wikilink format (handled by the image plugin)
      if (img.width && img.height) {
        postParams.content = postParams.content.replace(img.original, `![[${wpUrl}|${img.width}x${img.height}]]`);
      } else if (img.width) {
        postParams.content = postParams.content.replace(img.original, `![[${wpUrl}|${img.width}]]`);
      } else {
        postParams.content = postParams.content.replace(img.original, `![[${wpUrl}]]`);
      }
    }

    // Optionally rewrite the local note. Uses standard markdown syntax ![alt](url)
    // rather than wikilink syntax, so Obsidian can still display the remote image.
    // Reads from the live editor (not postParams.content) so that any pre-publish
    // transformations — e.g. stripped hashtags — are not written back to the note.
    if (this.plugin.settings.replaceMediaLinks && uploadCache.size > 0) {
      const { activeEditor } = this.plugin.app.workspace;
      if (activeEditor?.editor) {
        let noteContent = activeEditor.editor.getValue();
        for (const img of images) {
          if (img.srcIsUrl) continue;
          const wpUrl = uploadCache.get(decodeURI(img.src));
          if (!wpUrl) continue;
          noteContent = noteContent.replace(img.original, `![${img.altText ?? ''}](${wpUrl})`);
        }
        activeEditor.editor.setValue(noteContent);
      }
    }
  }

  async publishPost(defaultPostParams?: WordPressPostParams): Promise<WordPressClientResult<WordPressPublishResult>> {
    try {
      if (!this.profile.endpoint || this.profile.endpoint.length === 0) {
        throw new Error(this.plugin.i18n.t('error_noEndpoint'));
      }
      // const { activeEditor } = this.plugin.app.workspace;
      const file = this.plugin.app.workspace.getActiveFile()
      if (file === null) {
        throw new Error(this.plugin.i18n.t('error_noActiveFile'));
      }

      // get auth info
      const auth = await this.getAuth();

      // read note title, content and matter data
      const title = file.basename;
      const { content, matter: matterData } = await processFile(file, this.plugin.app);
      
      // check if profile selected is matched to the one in note property,
      // if not, ask whether to update or not
      await this.checkExistingProfile(matterData);

      // now we're preparing the publishing data
      let postParams: WordPressPostParams;
      let result: WordPressClientResult<WordPressPublishResult> | undefined;
      if (defaultPostParams) {
        postParams = this.readFromFrontMatter(title, matterData, defaultPostParams);
        postParams.content = content;
        result = await this.tryToPublish({
          auth,
          postParams
        });
      } else {
        const categories = await this.getCategories(auth);
        const selectedCategories = matterData.categories as number[]
          ?? this.profile.lastSelectedCategories
          ?? [ 1 ];
        const postTypes = await this.getPostTypes(auth);
        if (postTypes.length === 0) {
          postTypes.push(PostTypeConst.Post);
        }
        const selectedPostType = matterData.postType ?? PostTypeConst.Post;
        result = await new Promise(resolve => {
          const publishModal = new WpPublishModal(
            this.plugin,
            { items: categories, selected: selectedCategories },
            { items: postTypes, selected: selectedPostType },
            async (postParams: WordPressPostParams, updateMatterData: (matter: MatterData) => void) => {
              postParams = this.readFromFrontMatter(title, matterData, postParams);
              postParams.content = content;
              try {
                const r = await this.tryToPublish({
                  auth,
                  postParams,
                  updateMatterData
                });
                if (r.code === WordPressClientReturnCode.OK) {
                  publishModal.close();
                  resolve(r);
                }
              } catch (error) {
                if (error instanceof Error) {
                  return showError(error);
                } else {
                  throw error;
                }
              }
            },
            matterData);
          publishModal.open();
        });
      }
      if (result) {
        return result;
      } else {
        throw new Error(this.plugin.i18n.t("message_publishFailed"));
      }
    } catch (error) {
      if (error instanceof Error) {
        return showError(error);
      } else {
        throw error;
      }
    }
  }

  private async getTags(tags: string[], certificate: WordPressAuthParams): Promise<Term[]> {
    const results = await Promise.allSettled(tags.map(name => this.getTag(name, certificate)));
    const terms: Term[] = [];
    results
      .forEach(result => {
        if (isPromiseFulfilledResult<Term>(result)) {
          terms.push(result.value);
        }
      });
    return terms;
  }

  private readFromFrontMatter(
    noteTitle: string,
    matterData: MatterData,
    params: WordPressPostParams
  ): WordPressPostParams {
    const postParams = { ...params };
    postParams.title = noteTitle;
    if (matterData.title) {
      postParams.title = matterData.title;
    }
    if (matterData.postId) {
      postParams.postId = matterData.postId;
    }
    postParams.profileName = matterData.profileName ?? WP_DEFAULT_PROFILE_NAME;
    if (matterData.postType) {
      postParams.postType = matterData.postType;
    } else {
      // if there is no post type in matter-data, assign it as 'post'
      postParams.postType = PostTypeConst.Post;
    }
    if (postParams.postType === PostTypeConst.Post) {
      // only 'post' supports categories and tags
      if (matterData.categories) {
        postParams.categories = matterData.categories as number[] ?? this.profile.lastSelectedCategories;
      }
      if (matterData.tags) {
        postParams.tags = matterData.tags as string[];
      }
    }
    return postParams;
  }

}

interface Image {
  original: string;
  src: string;
  altText?: string;
  width?: string;
  height?: string;
  srcIsUrl: boolean;
  startIndex: number;
  endIndex: number;
  file?: TFile;
  content?: ArrayBuffer;
}

/**
 * Wrap rendered HTML in Gutenberg block comments so WordPress stores each
 * element as a native block rather than a freeform Classic block.
 *
 * Common block mappings:
 *   <p>            → wp:paragraph
 *   <h1>–<h6>      → wp:heading  {"level": N}
 *   <ul>           → wp:list
 *   <ol>           → wp:list     {"ordered": true}
 *   <pre>          → wp:code
 *   <blockquote>   → wp:quote
 *   <figure>/<img> → wp:image
 *   <hr>           → wp:separator
 *   <table>        → wp:table
 *   everything else → wp:html   (safe freeform fallback)
 */
function htmlToGutenbergBlocks(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const blocks: string[] = [];

  for (const node of Array.from(container.children)) {
    const tag = node.tagName.toLowerCase();

    switch (tag) {
      case 'p':
        blocks.push(`<!-- wp:paragraph -->\n${node.outerHTML}\n<!-- /wp:paragraph -->`);
        break;

      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = parseInt(tag[1], 10);
        blocks.push(`<!-- wp:heading {"level":${level}} -->\n${node.outerHTML}\n<!-- /wp:heading -->`);
        break;
      }

      case 'ul':
        blocks.push(`<!-- wp:list -->\n${node.outerHTML}\n<!-- /wp:list -->`);
        break;

      case 'ol':
        blocks.push(`<!-- wp:list {"ordered":true} -->\n${node.outerHTML}\n<!-- /wp:list -->`);
        break;

      case 'pre':
        blocks.push(`<!-- wp:code -->\n${node.outerHTML}\n<!-- /wp:code -->`);
        break;

      case 'blockquote':
        blocks.push(`<!-- wp:quote -->\n${node.outerHTML}\n<!-- /wp:quote -->`);
        break;

      case 'figure':
      case 'img': {
        const figure = tag === 'img'
          ? `<figure class="wp-block-image">${node.outerHTML}</figure>`
          : node.outerHTML;
        blocks.push(`<!-- wp:image -->\n${figure}\n<!-- /wp:image -->`);
        break;
      }

      case 'hr':
        // Gutenberg requires the wp-block-separator class to parse the block cleanly;
        // bare <hr> triggers a "block recovery" prompt in the editor.
        blocks.push(`<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`);
        break;

      case 'table':
        blocks.push(`<!-- wp:table -->\n<figure class="wp-block-table">${node.outerHTML}</figure>\n<!-- /wp:table -->`);
        break;

      default:
        // Unknown element: safe freeform fallback
        blocks.push(`<!-- wp:html -->\n${node.outerHTML}\n<!-- /wp:html -->`);
    }
  }

  return blocks.join('\n\n');
}

function extractTrailingHashtags(content: string): { content: string; tags: string[] } {
  // Match a trailing block of lines containing only #tags (no space after #, so headings are safe)
  const trailingTagBlock = /\n+((?:[ \t]*#[\w/-]+[ \t]*\n?)+)$/;
  const match = content.match(trailingTagBlock);
  if (!match) return { content, tags: [] };
  const tags = [...match[1].matchAll(/#([\w/-]+)/g)].map(m => m[1]);
  return {
    content: content.slice(0, content.length - match[0].length).trimEnd(),
    tags,
  };
}

function getImages(content: string): Image[] {
  const paths: Image[] = [];

  // for ![Alt Text](image-url)
  let regex = /(!\[(.*?)(?:\|(\d+)(?:x(\d+))?)?]\((.*?)\))/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    paths.push({
      src: match[5],
      altText: match[2],
      width: match[3],
      height: match[4],
      original: match[1],
      startIndex: match.index,
      endIndex: match.index + match.length,
      srcIsUrl: isValidUrl(match[5]),
    });
  }

  // for ![[image-name]]
  regex = /(!\[\[(.*?)(?:\|(\d+)(?:x(\d+))?)?]])/g;
  while ((match = regex.exec(content)) !== null) {
    paths.push({
      src: match[2],
      original: match[1],
      width: match[3],
      height: match[4],
      startIndex: match.index,
      endIndex: match.index + match.length,
      srcIsUrl: isValidUrl(match[2]),
    });
  }

  return paths;
}
