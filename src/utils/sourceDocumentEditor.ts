import { Buffer } from 'node:buffer';
import { Sandbox } from '@vercel/sandbox';
import { ModelId } from '@/types/chat';
import { createServiceClient } from '@/utils/supabase/service';
import { parseDocx } from '@/utils/docxParser';
import { renderDocxPages } from '@/utils/docxPageRenderer';
import { persistGeneratedDocument } from '@/utils/generatedDocumentStorage';
import { persistDocxRenderedPages } from '@/utils/docxRenderedPages';
import { persistPdfRenderedPages } from '@/utils/pdfRenderedPages';
import { ingestParsedDocument } from '@/utils/discussionMemory';
import {
  persistDocumentStateSnapshot,
  type DocumentStateSnapshot,
} from '@/utils/documentRevisionState';

const SOURCE_EDIT_SNAPSHOT_ID = 'snap_vwQhLmdtlIxq4OliWzLOjVlHEzuD';
const MAX_SOURCE_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_RENDERED_PAGES = 12;

const DOCX_EDIT_SCRIPT = Buffer.from(
  'aW1wb3J0IGpzb24sIG9zLCByZSwgc3lzLCB0ZW1wZmlsZSwgemlwZmlsZQpmcm9tIHhtbC5ldHJlZSBpbXBvcnQgRWxlbWVudFRyZWUgYXMgRVQKClcgPSAnaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3dvcmRwcm9jZXNzaW5nbWwvMjAwNi9tYWluJwpYTUwgPSAnaHR0cDovL3d3dy53My5vcmcvWE1MLzE5OTgvbmFtZXNwYWNlJwpOUyA9IHsndyc6IFd9CkVULnJlZ2lzdGVyX25hbWVzcGFjZSgndycsIFcpCgpzcmMsIHBsYW5fcGF0aCwgb3V0ID0gc3lzLmFyZ3ZbMV0sIHN5cy5hcmd2WzJdLCBzeXMuYXJndlszXQp3aXRoIG9wZW4ocGxhbl9wYXRoLCAncicsIGVuY29kaW5nPSd1dGYtOCcpIGFzIGY6CiAgICBlZGl0cyA9IGpzb24ubG9hZChmKQoKd29yayA9IHRlbXBmaWxlLm1rZHRlbXAocHJlZml4PSdwbHVyaWxvZy1kb2N4LScpCndpdGggemlwZmlsZS5aaXBGaWxlKHNyYywgJ3InKSBhcyB6OgogICAgei5leHRyYWN0YWxsKHdvcmspCgpzdHlsZXNfcGF0aCA9IG9zLnBhdGguam9pbih3b3JrLCAnd29yZCcsICdzdHlsZXMueG1sJykKc3R5bGVfc2l6ZXMgPSB7fQpzdHlsZV9iYXNlZF9vbiA9IHt9CmRlZmF1bHRfc2l6ZSA9IDExLjAKaWYgb3MucGF0aC5leGlzdHMoc3R5bGVzX3BhdGgpOgogICAgc3RyZWUgPSBFVC5wYXJzZShzdHlsZXNfcGF0aCkKICAgIHNyb290ID0gc3RyZWUuZ2V0cm9vdCgpCiAgICBkc3ogPSBzcm9vdC5maW5kKCcuLy93OmRvY0RlZmF1bHRzL3c6clByRGVmYXVsdC93OnJQci93OnN6JywgTlMpCiAgICBpZiBkc3ogaXMgbm90IE5vbmUgYW5kIGRzei5nZXQoJ3slc312YWwnICUgVyk6CiAgICAgICAgdHJ5OiBkZWZhdWx0X3NpemUgPSBmbG9hdChkc3ouZ2V0KCd7JXN9dmFsJyAlIFcpKSAvIDIuMAogICAgICAgIGV4Y2VwdDogcGFzcwogICAgZm9yIHN0eWxlIGluIHNyb290LmZpbmRhbGwoJy4vL3c6c3R5bGUnLCBOUyk6CiAgICAgICAgc2lkID0gc3R5bGUuZ2V0KCd7JXN9c3R5bGVJZCcgJSBXKQogICAgICAgIGlmIG5vdCBzaWQ6IGNvbnRpbnVlCiAgICAgICAgYmFzZWQgPSBzdHlsZS5maW5kKCd3OmJhc2VkT24nLCBOUykKICAgICAgICBpZiBiYXNlZCBpcyBub3QgTm9uZToKICAgICAgICAgICAgc3R5bGVfYmFzZWRfb25bc2lkXSA9IGJhc2VkLmdldCgneyVzfXZhbCcgJSBXKQogICAgICAgIHN6ID0gc3R5bGUuZmluZCgndzpyUHIvdzpzeicsIE5TKQogICAgICAgIGlmIHN6IGlzIG5vdCBOb25lIGFuZCBzei5nZXQoJ3slc312YWwnICUgVyk6CiAgICAgICAgICAgIHRyeTogc3R5bGVfc2l6ZXNbc2lkXSA9IGZsb2F0KHN6LmdldCgneyVzfXZhbCcgJSBXKSkgLyAyLjAKICAgICAgICAgICAgZXhjZXB0OiBwYXNzCgpkZWYgc3R5bGVfc2l6ZShzdHlsZV9pZCk6CiAgICBzZWVuID0gc2V0KCkKICAgIGN1ciA9IHN0eWxlX2lkCiAgICB3aGlsZSBjdXIgYW5kIGN1ciBub3QgaW4gc2VlbjoKICAgICAgICBzZWVuLmFkZChjdXIpCiAgICAgICAgaWYgY3VyIGluIHN0eWxlX3NpemVzOgogICAgICAgICAgICByZXR1cm4gc3R5bGVfc2l6ZXNbY3VyXQogICAgICAgIGN1ciA9IHN0eWxlX2Jhc2VkX29uLmdldChjdXIpCiAgICByZXR1cm4gZGVmYXVsdF9zaXplCgpkZWYgdGV4dF9ub2RlcyhwKToKICAgIHJldHVybiBwLmZpbmRhbGwoJy4vL3c6dCcsIE5TKQoKZGVmIHB0ZXh0KHApOgogICAgcmV0dXJuICcnLmpvaW4oKG4udGV4dCBvciAnJykgZm9yIG4gaW4gdGV4dF9ub2RlcyhwKSkKCmRlZiBydW5zKHApOgogICAgcmV0dXJuIHAuZmluZGFsbCgnLi8vdzpyJywgTlMpCgpkZWYgcnRleHQocik6CiAgICByZXR1cm4gJycuam9pbigobi50ZXh0IG9yICcnKSBmb3IgbiBpbiByLmZpbmRhbGwoJy4vL3c6dCcsIE5TKSkKCmRlZiBwX3N0eWxlX2lkKHApOgogICAgbm9kZSA9IHAuZmluZCgndzpwUHIvdzpwU3R5bGUnLCBOUykKICAgIHJldHVybiBub2RlLmdldCgneyVzfXZhbCcgJSBXKSBpZiBub2RlIGlzIG5vdCBOb25lIGVsc2UgTm9uZQoKZGVmIGVmZmVjdGl2ZV9ydW5fc2l6ZShydW4sIHApOgogICAgcnByID0gcnVuLmZpbmQoJ3c6clByJywgTlMpCiAgICBpZiBycHIgaXMgbm90IE5vbmU6CiAgICAgICAgc3ogPSBycHIuZmluZCgndzpzeicsIE5TKQogICAgICAgIGlmIHN6IGlzIG5vdCBOb25lIGFuZCBzei5nZXQoJ3slc312YWwnICUgVyk6CiAgICAgICAgICAgIHRyeTogcmV0dXJuIGZsb2F0KHN6LmdldCgneyVzfXZhbCcgJSBXKSkgLyAyLjAKICAgICAgICAgICAgZXhjZXB0OiBwYXNzCiAgICByZXR1cm4gc3R5bGVfc2l6ZShwX3N0eWxlX2lkKHApKQoKZGVmIHNldF9ydW5fc2l6ZShydW4sIHAsIGFic29sdXRlPU5vbmUsIGRlbHRhPU5vbmUpOgogICAgY3VycmVudCA9IGVmZmVjdGl2ZV9ydW5fc2l6ZShydW4sIHApCiAgICBzaXplID0gYWJzb2x1dGUgaWYgYWJzb2x1dGUgaXMgbm90IE5vbmUgZWxzZSBjdXJyZW50ICsgKGRlbHRhIG9yIDApCiAgICBzaXplID0gbWF4KDUuMCwgbWluKDk2LjAsIGZsb2F0KHNpemUpKSkKICAgIHJwciA9IHJ1bi5maW5kKCd3OnJQcicsIE5TKQogICAgaWYgcnByIGlzIE5vbmU6CiAgICAgICAgcnByID0gRVQuRWxlbWVudCgneyVzfXJQcicgJSBXKQogICAgICAgIHJ1bi5pbnNlcnQoMCwgcnByKQogICAgZm9yIG5hbWUgaW4gKCdzeicsICdzekNzJyk6CiAgICAgICAgbm9kZSA9IHJwci5maW5kKCd3OicgKyBuYW1lLCBOUykKICAgICAgICBpZiBub2RlIGlzIE5vbmU6CiAgICAgICAgICAgIG5vZGUgPSBFVC5TdWJFbGVtZW50KHJwciwgJ3slc30lcycgJSAoVywgbmFtZSkpCiAgICAgICAgbm9kZS5zZXQoJ3slc312YWwnICUgVywgc3RyKGludChyb3VuZChzaXplICogMikpKSkKCmRlZiBzZXRfdG9nZ2xlKHJ1biwgbmFtZSwgdmFsdWUpOgogICAgcnByID0gcnVuLmZpbmQoJ3c6clByJywgTlMpCiAgICBpZiBycHIgaXMgTm9uZToKICAgICAgICBycHIgPSBFVC5FbGVtZW50KCd7JXN9clByJyAlIFcpCiAgICAgICAgcnVuLmluc2VydCgwLCBycHIpCiAgICBub2RlID0gcnByLmZpbmQoJ3c6JyArIG5hbWUsIE5TKQogICAgaWYgbm9kZSBpcyBOb25lOgogICAgICAgIG5vZGUgPSBFVC5TdWJFbGVtZW50KHJwciwgJ3slc30lcycgJSAoVywgbmFtZSkpCiAgICBub2RlLnNldCgneyVzfXZhbCcgJSBXLCAnMScgaWYgdmFsdWUgZWxzZSAnMCcpCgpkZWYgcmVwbGFjZV9yYW5nZShwLCBzdGFydCwgZW5kLCByZXBsYWNlbWVudCk6CiAgICBub2RlcyA9IHRleHRfbm9kZXMocCkKICAgIHNwYW5zID0gW10KICAgIHBvcyA9IDAKICAgIGZvciBub2RlIGluIG5vZGVzOgogICAgICAgIHR4dCA9IG5vZGUudGV4dCBvciAnJwogICAgICAgIHNwYW5zLmFwcGVuZCgobm9kZSwgcG9zLCBwb3MgKyBsZW4odHh0KSkpCiAgICAgICAgcG9zICs9IGxlbih0eHQpCiAgICBhZmZlY3RlZCA9IFsobixzLGUpIGZvciBuLHMsZSBpbiBzcGFucyBpZiBlID4gc3RhcnQgYW5kIHMgPCBlbmRdCiAgICBpZiBub3QgYWZmZWN0ZWQ6CiAgICAgICAgcmV0dXJuIEZhbHNlCiAgICBmaXJzdF9ub2RlLCBmcywgZmUgPSBhZmZlY3RlZFswXQogICAgbGFzdF9ub2RlLCBscywgbGUgPSBhZmZlY3RlZFstMV0KICAgIGZpcnN0X3R4dCA9IGZpcnN0X25vZGUudGV4dCBvciAnJwogICAgcHJlZml4ID0gZmlyc3RfdHh0WzptYXgoMCwgc3RhcnQtZnMpXQogICAgaWYgZmlyc3Rfbm9kZSBpcyBsYXN0X25vZGU6CiAgICAgICAgc3VmZml4ID0gZmlyc3RfdHh0W21heCgwLCBlbmQtZnMpOl0KICAgICAgICBmaXJzdF9ub2RlLnRleHQgPSBwcmVmaXggKyByZXBsYWNlbWVudCArIHN1ZmZpeAogICAgZWxzZToKICAgICAgICBmaXJzdF9ub2RlLnRleHQgPSBwcmVmaXggKyByZXBsYWNlbWVudAogICAgICAgIGZvciBub2RlLCBfLCBfIGluIGFmZmVjdGVkWzE6LTFdOgogICAgICAgICAgICBub2RlLnRleHQgPSAnJwogICAgICAgIGxhc3RfdHh0ID0gbGFzdF9ub2RlLnRleHQgb3IgJycKICAgICAgICBsYXN0X25vZGUudGV4dCA9IGxhc3RfdHh0W21heCgwLCBlbmQtbHMpOl0KICAgIGZvciBub2RlLCBfLCBfIGluIGFmZmVjdGVkOgogICAgICAgIHZhbHVlID0gbm9kZS50ZXh0IG9yICcnCiAgICAgICAgaWYgdmFsdWUuc3RhcnRzd2l0aCgnICcpIG9yIHZhbHVlLmVuZHN3aXRoKCcgJyk6CiAgICAgICAgICAgIG5vZGUuc2V0KCd7JXN9c3BhY2UnICUgWE1MLCAncHJlc2VydmUnKQogICAgcmV0dXJuIFRydWUKCmRlZiBvdmVybGFwcGluZ19ydW5zKHAsIHN0YXJ0LCBlbmQpOgogICAgb3V0ID0gW10KICAgIHBvcyA9IDAKICAgIGZvciBydW4gaW4gcnVucyhwKToKICAgICAgICB0eHQgPSBydGV4dChydW4pCiAgICAgICAgcywgZSA9IHBvcywgcG9zICsgbGVuKHR4dCkKICAgICAgICBpZiBlID4gc3RhcnQgYW5kIHMgPCBlbmQ6CiAgICAgICAgICAgIG91dC5hcHBlbmQocnVuKQogICAgICAgIHBvcyA9IGUKICAgIHJldHVybiBvdXQKCndvcmRfZGlyID0gb3MucGF0aC5qb2luKHdvcmssICd3b3JkJykKeG1sX2ZpbGVzID0gW29zLnBhdGguam9pbih3b3JkX2RpciwgJ2RvY3VtZW50LnhtbCcpXQpmb3IgbmFtZSBpbiBzb3J0ZWQob3MubGlzdGRpcih3b3JkX2RpcikpOgogICAgaWYgcmUubWF0Y2gocideKGhlYWRlcnxmb290ZXIpXGQqXC54bWwkJywgbmFtZSk6CiAgICAgICAgeG1sX2ZpbGVzLmFwcGVuZChvcy5wYXRoLmpvaW4od29yZF9kaXIsIG5hbWUpKQoKdHJlZXMgPSBbKHBhdGgsIEVULnBhcnNlKHBhdGgpKSBmb3IgcGF0aCBpbiB4bWxfZmlsZXMgaWYgb3MucGF0aC5leGlzdHMocGF0aCldCgpmb3IgZWRpdCBpbiBlZGl0czoKICAgIHRhcmdldCA9IHN0cihlZGl0LmdldCgndGFyZ2V0X3RleHQnKSBvciAnJykKICAgIGlmIG5vdCB0YXJnZXQ6CiAgICAgICAgcmFpc2UgUnVudGltZUVycm9yKCdFbXB0eSB0YXJnZXRfdGV4dCcpCiAgICBvY2N1cnJlbmNlID0gbWF4KDEsIGludChlZGl0LmdldCgnb2NjdXJyZW5jZScpIG9yIDEpKQogICAgbWF0Y2hlcyA9IFtdCiAgICBmb3IgcGF0aCwgdHJlZSBpbiB0cmVlczoKICAgICAgICBmb3IgcCBpbiB0cmVlLmdldHJvb3QoKS5maW5kYWxsKCcuLy93OnAnLCBOUyk6CiAgICAgICAgICAgIHR4dCA9IHB0ZXh0KHApCiAgICAgICAgICAgIHN0YXJ0ID0gMAogICAgICAgICAgICB3aGlsZSBUcnVlOgogICAgICAgICAgICAgICAgaWR4ID0gdHh0LmZpbmQodGFyZ2V0LCBzdGFydCkKICAgICAgICAgICAgICAgIGlmIGlkeCA8IDA6IGJyZWFrCiAgICAgICAgICAgICAgICBtYXRjaGVzLmFwcGVuZCgocCwgaWR4LCBpZHggKyBsZW4odGFyZ2V0KSkpCiAgICAgICAgICAgICAgICBzdGFydCA9IGlkeCArIG1heCgxLCBsZW4odGFyZ2V0KSkKICAgIGlmIG9jY3VycmVuY2UgPiBsZW4obWF0Y2hlcyk6CiAgICAgICAgcmFpc2UgUnVudGltZUVycm9yKCJUYXJnZXQgbm90IGZvdW5kIGF0IHJlcXVlc3RlZCBvY2N1cnJlbmNlOiAlciAoIyVkLCBtYXRjaGVzPSVkKSIgJSAodGFyZ2V0LCBvY2N1cnJlbmNlLCBsZW4obWF0Y2hlcykpKQogICAgcCwgc3RhcnQsIGVuZCA9IG1hdGNoZXNbb2NjdXJyZW5jZSAtIDFdCiAgICBhY3Rpb24gPSBlZGl0LmdldCgnYWN0aW9uJykKICAgIGlmIGFjdGlvbiA9PSAncmVwbGFjZV90ZXh0JzoKICAgICAgICByZXBsYWNlX3JhbmdlKHAsIHN0YXJ0LCBlbmQsIHN0cihlZGl0LmdldCgncmVwbGFjZW1lbnRfdGV4dCcpIG9yICcnKSkKICAgIGVsaWYgYWN0aW9uID09ICdkZWxldGVfdGV4dCc6CiAgICAgICAgcmVwbGFjZV9yYW5nZShwLCBzdGFydCwgZW5kLCAnJykKICAgIGVsaWYgYWN0aW9uID09ICdzZXRfZm9udF9zaXplJzoKICAgICAgICBmb3IgcnVuIGluIG92ZXJsYXBwaW5nX3J1bnMocCwgc3RhcnQsIGVuZCk6CiAgICAgICAgICAgIHNldF9ydW5fc2l6ZShydW4sIHAsIGVkaXQuZ2V0KCdmb250X3NpemVfcHQnKSwgZWRpdC5nZXQoJ2ZvbnRfc2l6ZV9kZWx0YV9wdCcpKQogICAgZWxpZiBhY3Rpb24gaW4gKCdzZXRfYm9sZCcsICdzZXRfaXRhbGljJyk6CiAgICAgICAgcHJvcCA9ICdiJyBpZiBhY3Rpb24gPT0gJ3NldF9ib2xkJyBlbHNlICdpJwogICAgICAgIGZvciBydW4gaW4gb3ZlcmxhcHBpbmdfcnVucyhwLCBzdGFydCwgZW5kKToKICAgICAgICAgICAgc2V0X3RvZ2dsZShydW4sIHByb3AsIGJvb2woZWRpdC5nZXQoJ3ZhbHVlJywgVHJ1ZSkpKQogICAgZWxpZiBhY3Rpb24gPT0gJ3NldF9hbGlnbm1lbnQnOgogICAgICAgIHBwciA9IHAuZmluZCgndzpwUHInLCBOUykKICAgICAgICBpZiBwcHIgaXMgTm9uZToKICAgICAgICAgICAgcHByID0gRVQuRWxlbWVudCgneyVzfXBQcicgJSBXKQogICAgICAgICAgICBwLmluc2VydCgwLCBwcHIpCiAgICAgICAgamMgPSBwcHIuZmluZCgndzpqYycsIE5TKQogICAgICAgIGlmIGpjIGlzIE5vbmU6CiAgICAgICAgICAgIGpjID0gRVQuU3ViRWxlbWVudChwcHIsICd7JXN9amMnICUgVykKICAgICAgICBqYy5zZXQoJ3slc312YWwnICUgVywgZWRpdC5nZXQoJ2FsaWdubWVudCcpIG9yICdsZWZ0JykKICAgIGVsc2U6CiAgICAgICAgcmFpc2UgUnVudGltZUVycm9yKCdVbnN1cHBvcnRlZCBET0NYIGVkaXQgYWN0aW9uOiAlcycgJSBhY3Rpb24pCgpmb3IgcGF0aCwgdHJlZSBpbiB0cmVlczoKICAgIHRyZWUud3JpdGUocGF0aCwgZW5jb2Rpbmc9J1VURi04JywgeG1sX2RlY2xhcmF0aW9uPVRydWUpCgp3aXRoIHppcGZpbGUuWmlwRmlsZShvdXQsICd3JywgemlwZmlsZS5aSVBfREVGTEFURUQpIGFzIHo6CiAgICBmb3Igcm9vdCwgZGlycywgZmlsZXMgaW4gb3Mud2Fsayh3b3JrKToKICAgICAgICBmb3IgbmFtZSBpbiBmaWxlczoKICAgICAgICAgICAgcCA9IG9zLnBhdGguam9pbihyb290LCBuYW1lKQogICAgICAgICAgICB6LndyaXRlKHAsIG9zLnBhdGgucmVscGF0aChwLCB3b3JrKSk=',
  'base64'
).toString('utf8');

const PDF_EDIT_SCRIPT = Buffer.from(
  'aW1wb3J0IGpzb24sIG9zLCBzdWJwcm9jZXNzLCBzeXMKaW1wb3J0IGZpdHoKCnNyYywgcGxhbl9wYXRoLCBvdXQgPSBzeXMuYXJndlsxXSwgc3lzLmFyZ3ZbMl0sIHN5cy5hcmd2WzNdCndpdGggb3BlbihwbGFuX3BhdGgsICdyJywgZW5jb2Rpbmc9J3V0Zi04JykgYXMgZjoKICAgIGVkaXRzID0ganNvbi5sb2FkKGYpCmRvYyA9IGZpdHoub3BlbihzcmMpCgpkZWYgcmdiKHYpOgogICAgdHJ5OgogICAgICAgIHYgPSBpbnQodikKICAgICAgICByZXR1cm4gKCgodiA+PiAxNikgJiAyNTUpLzI1NS4wLCAoKHYgPj4gOCkgJiAyNTUpLzI1NS4wLCAodiAmIDI1NSkvMjU1LjApCiAgICBleGNlcHQ6CiAgICAgICAgcmV0dXJuICgwLDAsMCkKCmRlZiBiZ19jb2xvcihwYWdlLCByZWN0KToKICAgIGNsaXAgPSBmaXR6LlJlY3QobWF4KHBhZ2UucmVjdC54MCwgcmVjdC54MC0yKSwgbWF4KHBhZ2UucmVjdC55MCwgcmVjdC55MC0yKSwKICAgICAgICAgICAgICAgICAgICAgbWluKHBhZ2UucmVjdC54MSwgcmVjdC54MSsyKSwgbWluKHBhZ2UucmVjdC55MSwgcmVjdC55MSsyKSkKICAgIHRyeToKICAgICAgICBwaXggPSBwYWdlLmdldF9waXhtYXAobWF0cml4PWZpdHouTWF0cml4KDEsMSksIGNsaXA9Y2xpcCwgYWxwaGE9RmFsc2UpCiAgICAgICAgaWYgcGl4LndpZHRoIDwgMSBvciBwaXguaGVpZ2h0IDwgMSBvciBwaXgubiA8IDM6IHJldHVybiAoMSwxLDEpCiAgICAgICAgcHRzPVtdCiAgICAgICAgZm9yIHgseSBpbiBbKDAsMCksKHBpeC53aWR0aC0xLDApLCgwLHBpeC5oZWlnaHQtMSksKHBpeC53aWR0aC0xLHBpeC5oZWlnaHQtMSldOgogICAgICAgICAgICBpPSh5KnBpeC53aWR0aCt4KSpwaXgubgogICAgICAgICAgICBwdHMuYXBwZW5kKHR1cGxlKHBpeC5zYW1wbGVzW2kral0vMjU1LjAgZm9yIGogaW4gcmFuZ2UoMykpKQogICAgICAgIHJldHVybiB0dXBsZShzdW0ocFtrXSBmb3IgcCBpbiBwdHMpLzQgZm9yIGsgaW4gcmFuZ2UoMykpCiAgICBleGNlcHQ6CiAgICAgICAgcmV0dXJuICgxLDEsMSkKCmRlZiBiZXN0X3NwYW4ocGFnZSwgcmVjdCk6CiAgICBiZXN0LCBiZXN0X2FyZWEgPSB7fSwgMAogICAgZm9yIGJsb2NrIGluIHBhZ2UuZ2V0X3RleHQoJ2RpY3QnKS5nZXQoJ2Jsb2NrcycsIFtdKToKICAgICAgICBmb3IgbGluZSBpbiBibG9jay5nZXQoJ2xpbmVzJywgW10pOgogICAgICAgICAgICBmb3Igc3BhbiBpbiBsaW5lLmdldCgnc3BhbnMnLCBbXSk6CiAgICAgICAgICAgICAgICByPWZpdHouUmVjdChzcGFuLmdldCgnYmJveCcpKQogICAgICAgICAgICAgICAgaW50ZXI9ciAmIHJlY3QKICAgICAgICAgICAgICAgIGFyZWE9bWF4KDAsaW50ZXIud2lkdGgpKm1heCgwLGludGVyLmhlaWdodCkKICAgICAgICAgICAgICAgIGlmIGFyZWEgPiBiZXN0X2FyZWE6CiAgICAgICAgICAgICAgICAgICAgYmVzdCwgYmVzdF9hcmVhPXNwYW4sIGFyZWEKICAgIHJldHVybiBiZXN0CgpkZWYgZm9udF9uYW1lKHBhZ2UsIHNwYW4sIHRleHQsIGJvbGQ9RmFsc2UsIGl0YWxpYz1GYWxzZSk6CiAgICBpZiBhbnkob3JkKGNoKT4xMjcgZm9yIGNoIGluIHRleHQpOgogICAgICAgIHRyeToKICAgICAgICAgICAgZnA9c3VicHJvY2Vzcy5jaGVja19vdXRwdXQoWydmYy1tYXRjaCcsJy1mJywnJXtmaWxlfScsJ05vdG8gU2FucyBDSksgSlAnXSwgdGV4dD1UcnVlKS5zdHJpcCgpCiAgICAgICAgICAgIGlmIGZwIGFuZCBvcy5wYXRoLmV4aXN0cyhmcCk6CiAgICAgICAgICAgICAgICBuYW1lPSdQbHVyaWxvZ0NKSycKICAgICAgICAgICAgICAgIHRyeTogcGFnZS5pbnNlcnRfZm9udChmb250bmFtZT1uYW1lLCBmb250ZmlsZT1mcCkKICAgICAgICAgICAgICAgIGV4Y2VwdDogcGFzcwogICAgICAgICAgICAgICAgcmV0dXJuIG5hbWUKICAgICAgICBleGNlcHQ6CiAgICAgICAgICAgIHBhc3MKICAgIHJhdz1zdHIoc3Bhbi5nZXQoJ2ZvbnQnKSBvciAnJykubG93ZXIoKQogICAgaWYgYm9sZDogcmV0dXJuICdoZWJvJwogICAgaWYgaXRhbGljOiByZXR1cm4gJ2hlaXQnCiAgICBpZiAndGltZXMnIGluIHJhdyBvciAnc2VyaWYnIGluIHJhdzogcmV0dXJuICd0aXJvJwogICAgaWYgJ2NvdXJpZXInIGluIHJhdyBvciAnbW9ubycgaW4gcmF3OiByZXR1cm4gJ2NvdXInCiAgICByZXR1cm4gJ2hlbHYnCgpmb3IgZWRpdCBpbiBlZGl0czoKICAgIHRhcmdldD1zdHIoZWRpdC5nZXQoJ3RhcmdldF90ZXh0Jykgb3IgJycpCiAgICBpZiBub3QgdGFyZ2V0OiByYWlzZSBSdW50aW1lRXJyb3IoJ0VtcHR5IHRhcmdldF90ZXh0JykKICAgIG9jYz1tYXgoMSxpbnQoZWRpdC5nZXQoJ29jY3VycmVuY2UnKSBvciAxKSkKICAgIHBhZ2VfZmlsdGVyPWVkaXQuZ2V0KCdwYWdlX251bWJlcicpCiAgICBtYXRjaGVzPVtdCiAgICBmb3IgcGkgaW4gcmFuZ2UobGVuKGRvYykpOgogICAgICAgIGlmIHBhZ2VfZmlsdGVyIGFuZCBwaSsxICE9IGludChwYWdlX2ZpbHRlcik6IGNvbnRpbnVlCiAgICAgICAgZm9yIHJlY3QgaW4gZG9jW3BpXS5zZWFyY2hfZm9yKHRhcmdldCk6CiAgICAgICAgICAgIG1hdGNoZXMuYXBwZW5kKChwaSxyZWN0KSkKICAgIGlmIG9jYyA+IGxlbihtYXRjaGVzKToKICAgICAgICByYWlzZSBSdW50aW1lRXJyb3IoIlBERiB0YXJnZXQgbm90IGZvdW5kIGF0IHJlcXVlc3RlZCBvY2N1cnJlbmNlOiAlciAoIyVkLCBtYXRjaGVzPSVkKSIgJSAodGFyZ2V0LG9jYyxsZW4obWF0Y2hlcykpKQogICAgcGksIHJlY3Q9bWF0Y2hlc1tvY2MtMV0KICAgIHBhZ2U9ZG9jW3BpXQogICAgc3Bhbj1iZXN0X3NwYW4ocGFnZSxyZWN0KQogICAgYWN0aW9uPWVkaXQuZ2V0KCdhY3Rpb24nKQogICAgdGV4dD10YXJnZXQKICAgIGlmIGFjdGlvbiA9PSAncmVwbGFjZV90ZXh0JzogdGV4dD1zdHIoZWRpdC5nZXQoJ3JlcGxhY2VtZW50X3RleHQnKSBvciAnJykKICAgIGVsaWYgYWN0aW9uID09ICdkZWxldGVfdGV4dCc6IHRleHQ9JycKICAgIGVsaWYgYWN0aW9uIG5vdCBpbiAoJ3NldF9mb250X3NpemUnLCdzZXRfYm9sZCcsJ3NldF9pdGFsaWMnLCdzZXRfYWxpZ25tZW50Jyk6CiAgICAgICAgcmFpc2UgUnVudGltZUVycm9yKCdVbnN1cHBvcnRlZCBQREYgZWRpdCBhY3Rpb246ICVzJyAlIGFjdGlvbikKICAgIG9sZF9zaXplPWZsb2F0KHNwYW4uZ2V0KCdzaXplJykgb3IgMTEuMCkKICAgIHNpemU9ZWRpdC5nZXQoJ2ZvbnRfc2l6ZV9wdCcpCiAgICBpZiBzaXplIGlzIE5vbmU6IHNpemU9b2xkX3NpemUrZmxvYXQoZWRpdC5nZXQoJ2ZvbnRfc2l6ZV9kZWx0YV9wdCcpIG9yIDApCiAgICBzaXplPW1heCg1LjAsbWluKDk2LjAsZmxvYXQoc2l6ZSkpKQogICAgcGFkX3g9bWF4KDEuNSxvbGRfc2l6ZSowLjEyKTsgcGFkX3k9bWF4KDEuMCxvbGRfc2l6ZSowLjEwKQogICAgcnI9Zml0ei5SZWN0KHJlY3QueDAtcGFkX3gscmVjdC55MC1wYWRfeSxyZWN0LngxK3BhZF94LHJlY3QueTErcGFkX3kpCiAgICBwYWdlLmFkZF9yZWRhY3RfYW5ub3QocnIsIGZpbGw9YmdfY29sb3IocGFnZSxyZWN0KSkKICAgIHBhZ2UuYXBwbHlfcmVkYWN0aW9ucyhpbWFnZXM9MCwgZ3JhcGhpY3M9MCkKICAgIGlmIHRleHQ6CiAgICAgICAgc2NhbGU9bWF4KDEuMCxsZW4odGV4dCkvbWF4KDEsbGVuKHRhcmdldCkpLHNpemUvbWF4KDEuMCxvbGRfc2l6ZSkpCiAgICAgICAgd3I9Zml0ei5SZWN0KHJlY3QueDAtcGFkX3gscmVjdC55MC1wYWRfeSwKICAgICAgICAgICAgICAgICAgICAgbWluKHBhZ2UucmVjdC54MSxyZWN0LngwKyhyZWN0LndpZHRoKzIqcGFkX3gpKnNjYWxlKzE2KSwKICAgICAgICAgICAgICAgICAgICAgbWluKHBhZ2UucmVjdC55MSxyZWN0LnkwKyhyZWN0LmhlaWdodCsyKnBhZF95KSptYXgoMS4yNSxzY2FsZSkrMTApKQogICAgICAgIGFsaWduX25hbWU9ZWRpdC5nZXQoJ2FsaWdubWVudCcpCiAgICAgICAgYWxpZ249MSBpZiBhbGlnbl9uYW1lPT0nY2VudGVyJyBlbHNlIDIgaWYgYWxpZ25fbmFtZT09J3JpZ2h0JyBlbHNlIDAKICAgICAgICBmb250PWZvbnRfbmFtZShwYWdlLHNwYW4sdGV4dCxhY3Rpb249PSdzZXRfYm9sZCcgYW5kIGJvb2woZWRpdC5nZXQoJ3ZhbHVlJyxUcnVlKSksYWN0aW9uPT0nc2V0X2l0YWxpYycgYW5kIGJvb2woZWRpdC5nZXQoJ3ZhbHVlJyxUcnVlKSkpCiAgICAgICAgcmM9cGFnZS5pbnNlcnRfdGV4dGJveCh3cix0ZXh0LGZvbnRzaXplPXNpemUsZm9udG5hbWU9Zm9udCxjb2xvcj1yZ2Ioc3Bhbi5nZXQoJ2NvbG9yJywwKSksYWxpZ249YWxpZ24sb3ZlcmxheT1UcnVlKQogICAgICAgIGlmIHJjIDwgLTI6IHJhaXNlIFJ1bnRpbWVFcnJvcigiUmVwbGFjZW1lbnQgdGV4dCBkaWQgbm90IGZpdCB0YXJnZXQgcmVnaW9uIGZvciAlciIgJSB0YXJnZXQpCgpkb2Muc2F2ZShvdXQsZ2FyYmFnZT0zLGRlZmxhdGU9VHJ1ZSxjbGVhbj1GYWxzZSkKZG9jLmNsb3NlKCk=',
  'base64'
).toString('utf8');

export type SourceDocumentEditAction =
  | 'replace_text'
  | 'delete_text'
  | 'set_font_size'
  | 'set_bold'
  | 'set_italic'
  | 'set_alignment';

export interface SourceDocumentEditOperation {
  action: SourceDocumentEditAction;
  target_text: string;
  occurrence?: number;
  replacement_text?: string;
  font_size_pt?: number;
  font_size_delta_pt?: number;
  value?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  page_number?: number;
}

export interface SourceDocumentEditArgs {
  source_filename?: string;
  filename?: string;
  edits: SourceDocumentEditOperation[];
}

export interface ExecuteSourceDocumentEditOptions {
  supabase: any;
  openai: any;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  sourceStoragePath: string;
  sourceFilename: string;
  sourceDocumentId?: string | null;
  parentSnapshot?: DocumentStateSnapshot | null;
  args: SourceDocumentEditArgs;
  signal?: AbortSignal;
}

export interface ExecuteSourceDocumentEditResult {
  finalContent: string;
  format: 'docx' | 'pdf';
  messageId: string;
  createdAt: string;
  filename: string;
  storagePath: string;
  signedUrl: string;
  durableUrl: string;
  fullText: string;
  renderedPageAttachments: Array<{ url: string; filename: string }>;
  documentId?: string | null;
  documentStateId?: string | null;
  pageCount?: number | null;
  visualReviewCostUsd: number;
  visualReviewApplied: boolean;
  imageAssetCount: number;
  imageCostUsd: number;
}

interface EditedBytesResult {
  buffer: Buffer;
  fullText: string;
  pageCount: number | null;
  pages: Array<{
    pageNumber: number;
    data: Buffer;
    contentType: 'image/png';
  }>;
}

function cleanOutputFilename(sourceFilename: string, requested?: string): string {
  const source = (sourceFilename || 'document').split(/[\\/]/).pop() || 'document';
  const ext = source.toLowerCase().endsWith('.pdf') ? '.pdf' : '.docx';
  if (requested && requested.trim()) {
    const clean = requested
      .split(/[\\/]/)
      .pop()!
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim();
    const base = clean.replace(/\.(pdf|docx)$/i, '').trim() || 'document-edited';
    return base + ext;
  }
  const base = source.replace(/\.(pdf|docx)$/i, '').trim() || 'document';
  return base + '-edited' + ext;
}

function validateEdits(edits: SourceDocumentEditOperation[]): void {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('At least one source-document edit is required.');
  }
  if (edits.length > 24) {
    throw new Error('A source-preserving edit is limited to 24 targeted operations.');
  }
  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    if (!edit || typeof edit.target_text !== 'string' || !edit.target_text.trim()) {
      throw new Error('Source-document edit #' + (i + 1) + ' requires exact target_text.');
    }
    if (edit.action === 'replace_text' && typeof edit.replacement_text !== 'string') {
      throw new Error('replace_text edit #' + (i + 1) + ' requires replacement_text.');
    }
    if (
      edit.action === 'set_font_size' &&
      typeof edit.font_size_pt !== 'number' &&
      typeof edit.font_size_delta_pt !== 'number'
    ) {
      throw new Error(
        'set_font_size edit #' + (i + 1) + ' requires font_size_pt or font_size_delta_pt.'
      );
    }
    if (
      edit.action === 'set_alignment' &&
      !['left', 'center', 'right', 'justify'].includes(edit.alignment || '')
    ) {
      throw new Error('set_alignment edit #' + (i + 1) + ' requires alignment.');
    }
  }
}

async function assertCommand(
  result: Awaited<ReturnType<InstanceType<typeof Sandbox>['runCommand']>>,
  label: string
): Promise<void> {
  if (result.exitCode === 0) return;
  const stderr = (await result.stderr()).trim();
  const stdout = (await result.stdout()).trim();
  throw new Error(
    label +
      ' failed (exit ' +
      result.exitCode +
      '): ' +
      (stderr || stdout || 'unknown error').slice(-4000)
  );
}

async function createEditSandbox(timeoutMs: number, signal?: AbortSignal) {
  if (signal && signal.aborted) {
    throw new DOMException('Document edit aborted.', 'AbortError');
  }
  const sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId: SOURCE_EDIT_SNAPSHOT_ID },
    persistent: false,
    timeout: timeoutMs,
    networkPolicy: 'allow-all',
  });
  const abort = () => {
    void sandbox.stop().catch(() => undefined);
  };
  if (signal) signal.addEventListener('abort', abort, { once: true });
  return { sandbox, abort };
}

async function editDocxBytes(
  source: Buffer,
  edits: SourceDocumentEditOperation[],
  signal?: AbortSignal
): Promise<EditedBytesResult> {
  const created = await createEditSandbox(90_000, signal);
  const sandbox = created.sandbox;
  try {
    await sandbox.writeFiles([
      { path: '/vercel/sandbox/input.docx', content: source },
      {
        path: '/vercel/sandbox/plan.json',
        content: Buffer.from(JSON.stringify(edits), 'utf8'),
      },
      {
        path: '/vercel/sandbox/edit_docx.py',
        content: Buffer.from(DOCX_EDIT_SCRIPT, 'utf8'),
      },
    ]);
    const run = await sandbox.runCommand({
      cmd: 'python3',
      args: [
        '/vercel/sandbox/edit_docx.py',
        '/vercel/sandbox/input.docx',
        '/vercel/sandbox/plan.json',
        '/vercel/sandbox/output.docx',
      ],
    });
    await assertCommand(run, 'Source-preserving DOCX edit');
    const output = await sandbox.readFileToBuffer({
      path: '/vercel/sandbox/output.docx',
    });
    if (!output || !output.length) {
      throw new Error('DOCX edit produced an empty file.');
    }
    const parsed = await parseDocx(output);
    const rendered = await renderDocxPages(output, {
      signal,
      timeoutMs: 60_000,
    });
    return {
      buffer: output,
      fullText: parsed.markdown || rendered.renderedText || '',
      pageCount: rendered.totalPageCount,
      pages: rendered.pages,
    };
  } finally {
    if (signal) signal.removeEventListener('abort', created.abort);
    await sandbox.stop().catch(() => undefined);
  }
}

async function editPdfBytes(
  source: Buffer,
  edits: SourceDocumentEditOperation[],
  signal?: AbortSignal
): Promise<EditedBytesResult> {
  const created = await createEditSandbox(120_000, signal);
  const sandbox = created.sandbox;
  try {
    await sandbox.writeFiles([
      { path: '/vercel/sandbox/input.pdf', content: source },
      {
        path: '/vercel/sandbox/plan.json',
        content: Buffer.from(JSON.stringify(edits), 'utf8'),
      },
      {
        path: '/vercel/sandbox/edit_pdf.py',
        content: Buffer.from(PDF_EDIT_SCRIPT, 'utf8'),
      },
    ]);
    const ensure = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        "python3 -c 'import fitz' >/dev/null 2>&1 || python3 -m pip install --quiet --disable-pip-version-check 'PyMuPDF==1.26.4'",
      ],
    });
    await assertCommand(ensure, 'PyMuPDF setup');
    const run = await sandbox.runCommand({
      cmd: 'python3',
      args: [
        '/vercel/sandbox/edit_pdf.py',
        '/vercel/sandbox/input.pdf',
        '/vercel/sandbox/plan.json',
        '/vercel/sandbox/output.pdf',
      ],
    });
    await assertCommand(run, 'Source-preserving PDF edit');

    const info = await sandbox.runCommand({
      cmd: 'pdfinfo',
      args: ['/vercel/sandbox/output.pdf'],
    });
    await assertCommand(info, 'Edited PDF inspection');
    const infoText = await info.stdout();
    const pageMatch = infoText.match(/^Pages:\s+(\d+)$/im);
    const pageCount = pageMatch ? Number(pageMatch[1]) : null;

    const text = await sandbox.runCommand({
      cmd: 'pdftotext',
      args: ['/vercel/sandbox/output.pdf', '-'],
    });
    await assertCommand(text, 'Edited PDF text extraction');
    const fullText = (await text.stdout()).trim();

    const render = await sandbox.runCommand({
      cmd: 'pdftoppm',
      args: [
        '-png',
        '-r',
        '120',
        '-f',
        '1',
        '-l',
        String(MAX_RENDERED_PAGES),
        '/vercel/sandbox/output.pdf',
        '/vercel/sandbox/page',
      ],
    });
    await assertCommand(render, 'Edited PDF rendering');

    const listing = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        "find /vercel/sandbox -maxdepth 1 -type f -name 'page-*.png' -printf '%f\\n' | sort -V",
      ],
    });
    await assertCommand(listing, 'Edited PDF page enumeration');
    const names = (await listing.stdout())
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, MAX_RENDERED_PAGES);

    const pages: EditedBytesResult['pages'] = [];
    for (let i = 0; i < names.length; i += 1) {
      const data = await sandbox.readFileToBuffer({
        path: '/vercel/sandbox/' + names[i],
      });
      if (data && data.length) {
        pages.push({
          pageNumber: i + 1,
          data,
          contentType: 'image/png',
        });
      }
    }

    const output = await sandbox.readFileToBuffer({
      path: '/vercel/sandbox/output.pdf',
    });
    if (!output || !output.length) {
      throw new Error('PDF edit produced an empty file.');
    }
    return {
      buffer: output,
      fullText,
      pageCount:
        typeof pageCount === 'number' && Number.isFinite(pageCount)
          ? pageCount
          : null,
      pages,
    };
  } finally {
    if (signal) signal.removeEventListener('abort', created.abort);
    await sandbox.stop().catch(() => undefined);
  }
}

async function persistAssistantMessage(options: {
  supabase: any;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  content: string;
}): Promise<{ id: string; created_at: string }> {
  const result = await options.supabase
    .from('messages')
    .insert({
      id: options.messageId,
      discussion_id: options.discussionId,
      sender: options.seatId,
      content: options.content,
    })
    .select('id, created_at')
    .maybeSingle();

  if (!result.error && result.data) return result.data;

  if (result.error && result.error.code === '23505') {
    const existing = await options.supabase
      .from('messages')
      .select('id, created_at')
      .eq('id', options.messageId)
      .eq('discussion_id', options.discussionId)
      .eq('sender', options.seatId)
      .maybeSingle();
    if (!existing.error && existing.data) return existing.data;
  }

  throw new Error(
    'Failed to persist source-document edit response: ' +
      (result.error?.message || 'missing message')
  );
}

export function isSourcePreservingDocumentState(
  snapshot: DocumentStateSnapshot | null | undefined
): boolean {
  return Boolean(snapshot?.spec?.source_preserving?.engine === 'native-source-edit-v1');
}

export async function executeSourcePreservingDocumentEdit(
  options: ExecuteSourceDocumentEditOptions
): Promise<ExecuteSourceDocumentEditResult> {
  if (
    !options.discussionId ||
    !options.sourceStoragePath ||
    !options.sourceFilename
  ) {
    throw new Error('A concrete source document is required for editing.');
  }

  validateEdits(options.args.edits);

  const format: 'docx' | 'pdf' =
    options.sourceFilename.toLowerCase().endsWith('.pdf')
      ? 'pdf'
      : options.sourceFilename.toLowerCase().endsWith('.docx')
        ? 'docx'
        : (() => {
            throw new Error(
              'Source-preserving editing currently supports PDF and DOCX.'
            );
          })();

  const serviceClient = createServiceClient();
  const downloaded = await serviceClient.storage
    .from('message-images')
    .download(options.sourceStoragePath);

  if (downloaded.error || !downloaded.data) {
    throw new Error(
      'Could not load source document: ' +
        (downloaded.error?.message || 'not found')
    );
  }

  const sourceBytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (
    !sourceBytes.length ||
    sourceBytes.length > MAX_SOURCE_DOCUMENT_BYTES
  ) {
    throw new Error(
      'Source document size is unsupported (' + sourceBytes.length + ' bytes).'
    );
  }

  const edited =
    format === 'docx'
      ? await editDocxBytes(sourceBytes, options.args.edits, options.signal)
      : await editPdfBytes(sourceBytes, options.args.edits, options.signal);

  if (
    options.parentSnapshot?.pageCount &&
    edited.pageCount &&
    options.parentSnapshot.pageCount !== edited.pageCount
  ) {
    throw new Error(
      'Source-preserving edit changed page count from ' +
        options.parentSnapshot.pageCount +
        ' to ' +
        edited.pageCount +
        '.'
    );
  }

  const filename = cleanOutputFilename(
    options.sourceFilename,
    options.args.filename
  );
  const finalContent = 'Edited **' + filename + '**.';
  const persistedMsg = await persistAssistantMessage({
    supabase: options.supabase,
    discussionId: options.discussionId,
    messageId: options.messageId,
    seatId: options.seatId,
    content: finalContent,
  });

  const persisted = await persistGeneratedDocument({
    supabase: options.supabase,
    discussionId: options.discussionId,
    messageId: persistedMsg.id,
    seatId: options.seatId,
    fileBuffer: edited.buffer,
    filename,
    format,
  });

  let renderedPageAttachments: Array<{
    url: string;
    filename: string;
  }> = [];

  try {
    if (format === 'docx') {
      const pages = await persistDocxRenderedPages({
        supabase: options.supabase,
        parentFilename: persisted.filename,
        parentFileBytes: edited.buffer,
        pages: edited.pages,
      });
      renderedPageAttachments = pages.map((page) => ({
        url: page.signedUrl,
        filename: page.filename,
      }));
    } else {
      const pages = await persistPdfRenderedPages({
        supabase: options.supabase,
        parentFilename: persisted.filename,
        parentFileBytes: edited.buffer,
        pages: edited.pages,
      });
      renderedPageAttachments = pages.map((page) => ({
        url: page.signedUrl,
        filename: page.filename,
      }));
    }
  } catch (pageError) {
    console.warn(
      '[Source Document Edit] Non-critical rendered-page persistence error:',
      pageError
    );
  }

  try {
    await ingestParsedDocument({
      serviceSupabase: serviceClient,
      openai: options.openai,
      discussionId: options.discussionId,
      filename: persisted.filename,
      fullText: edited.fullText,
      fileBytes: edited.buffer,
      storagePath: persisted.storagePath,
      signal: options.signal,
    });
  } catch (ingestError) {
    console.warn(
      '[Source Document Edit] Non-critical indexing error:',
      ingestError
    );
  }

  let documentId: string | null = null;
  let documentStateId: string | null = null;

  try {
    const indexed = await serviceClient
      .from('discussion_documents')
      .select('id')
      .eq('discussion_id', options.discussionId)
      .eq('storage_path', persisted.storagePath)
      .maybeSingle();

    documentId = indexed.data?.id || null;

    const previousHistory = Array.isArray(
      options.parentSnapshot?.spec?.source_preserving?.edit_history
    )
      ? options.parentSnapshot!.spec.source_preserving.edit_history
      : [];

    const state = await persistDocumentStateSnapshot({
      serviceSupabase: serviceClient,
      discussionId: options.discussionId,
      documentId,
      filename: persisted.filename,
      storagePath: persisted.storagePath,
      messageId: persistedMsg.id,
      format,
      spec: {
        source_preserving: {
          engine: 'native-source-edit-v1',
          format,
          original_storage_path:
            options.parentSnapshot?.spec?.source_preserving
              ?.original_storage_path || options.sourceStoragePath,
          original_filename:
            options.parentSnapshot?.spec?.source_preserving?.original_filename ||
            options.sourceFilename,
          edit_history: [
            ...previousHistory,
            {
              source_storage_path: options.sourceStoragePath,
              edits: options.args.edits,
            },
          ].slice(-20),
        },
      },
      fullText: edited.fullText,
      pageCount: edited.pageCount,
      parentSnapshotId: options.parentSnapshot?.id || null,
      parentDocumentId:
        options.parentSnapshot?.documentId || options.sourceDocumentId || null,
      parentStoragePath:
        options.parentSnapshot?.storagePath || options.sourceStoragePath,
      sourceDocumentIds: Array.from(
        new Set(
          [
            ...(options.parentSnapshot?.sourceDocumentIds || []),
            options.sourceDocumentId || null,
          ].filter((value): value is string => Boolean(value))
        )
      ),
      generationKind: 'revision',
    });

    documentStateId = state?.id || null;
  } catch (stateError) {
    console.warn(
      '[Source Document Edit] Non-critical state persistence error:',
      stateError
    );
  }

  return {
    finalContent,
    format,
    messageId: persistedMsg.id,
    createdAt: persistedMsg.created_at,
    filename: persisted.filename,
    storagePath: persisted.storagePath,
    signedUrl: persisted.signedUrl,
    durableUrl: persisted.durableUrl,
    fullText: edited.fullText,
    renderedPageAttachments,
    documentId,
    documentStateId,
    pageCount: edited.pageCount,
    visualReviewCostUsd: 0,
    visualReviewApplied: false,
    imageAssetCount: 0,
    imageCostUsd: 0,
  };
}
